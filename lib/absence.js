/**
 * 挂念与疏远
 * ==========
 *
 * 两条轴，必须**解耦**：
 *   挂念（yearning）  = 我多想你。见到人一次就补上，所以能瞬间清零
 *   疏远（estrangement）= 语气收不收。习惯断了要重新养，所以退得慢
 *
 * 为什么不能是同一个数：挂念 20% 配上疏远 75%，在同一个刻度上会自相矛盾。
 * 真实的人也不会——一年没联系，突然想起他还是很想（挂念高），
 * 但开口会先客气两句（疏远也高）。
 *
 * 数值全部是**人工锚点 + 对数时间插值**，不是拟合出来的，所以敢写在文档里。
 * 变化的时候改锚点、跑测试，别偷偷调系数。
 */

/** 挂念锚点：[小时, 强度]。第 3 天到顶，之后头也不回地淡下去 */
const YEARNING = [
  [0, 0],
  [2, 0.05],
  [12, 0.28],
  [24, 0.45],
  [48, 0.78],
  [72, 1.00],   // 三天：最想你
  [168, 0.85],  // 一周
  [720, 0.55],  // 一个月
  [2160, 0.33], // 三个月
  [8760, 0.20], // 一年
  [26280, 0.12],// 三年
]

/** 疏远锚点：一个月内是零，之后慢慢起，封顶 0.75（留一层熟人底子） */
const ESTRANGE = [
  [0, 0],
  [720, 0],     // 30 天内：一点不生分
  [1440, 0.15], // 60 天
  [4320, 0.35], // 半年
  [8760, 0.55], // 一年
  [26280, 0.70],// 三年
  [43800, 0.75],// 五年封顶
]

/** 疏远封顶：再久也不会变成陌生人 */
export const ESTRANGE_CAP = 0.75

/** 平滑一点的插值：对数时间，段内用 smoothstep，避免折线感 */
function interp(table, hours) {
  const h = Math.max(0, Number(hours) || 0)
  if (h <= table[0][0]) return table[0][1]
  const last = table[table.length - 1]
  if (h >= last[0]) return last[1]

  for (let i = 1; i < table.length; i++) {
    const [h1, v1] = table[i]
    if (h > h1) continue
    const [h0, v0] = table[i - 1]
    // 用 log(h+1) 让前几个小时变化更细
    const a = Math.log1p(h0)
    const b = Math.log1p(h1)
    const x = (Math.log1p(h) - a) / (b - a || 1)
    const s = x * x * (3 - 2 * x)   // smoothstep
    return v0 + (v1 - v0) * s
  }
  return last[1]
}

/** 多久没说话（小时）→ 挂念强度 0..1 */
export function yearning(hours) {
  return Number(interp(YEARNING, hours).toFixed(4))
}

/** 多久没说话（小时）→ 疏远强度 0..0.75 */
export function estrangement(hours) {
  return Number(Math.min(ESTRANGE_CAP, interp(ESTRANGE, hours)).toFixed(4))
}

/** 挂念峰值在哪个小时（给测试和文档用，别写死数字在别处） */
export function yearningPeakHours() {
  let best = 0
  let bestV = -1
  for (const [h, v] of YEARNING) if (v > bestV) { bestV = v; best = h }
  return best
}

/**
 * 恢复规则。
 *
 * 挂念：见到人就是补上了 → 直接清零。
 * 疏远：习惯断了得重新养 → 每轮退 15%，三轮退到一半左右。
 *       一年没联系，第一句要有点收着，第三句才回到原来的调子。
 */
export const ESTRANGE_RECOVER_PER_TURN = 0.15

export function recoverYearning() {
  return 0
}

export function recoverEstrangement(current) {
  const v = Math.max(0, Number(current) || 0)
  return Number(Math.max(0, v * (1 - ESTRANGE_RECOVER_PER_TURN)).toFixed(4))
}

/** 一句话描述，给注入用。不带催的意思，只说事实 */
export function describeAbsence(hours) {
  const y = yearning(hours)
  const e = estrangement(hours)
  if (!(hours > 0.01)) return { yearning: 0, estrangement: 0, text: '' }

  const pieces = []
  if (y >= 0.6) pieces.push('心里一直挂着')
  else if (y >= 0.3) pieces.push('时不时会想起')
  else if (y >= 0.1) pieces.push('偶尔掠过一下')

  if (e >= 0.5) pieces.push('还留着一点生分')
  else if (e >= 0.25) pieces.push('有点久没搭上话了')

  return { yearning: y, estrangement: e, text: pieces.join('，') }
}
