/**
 * 情绪动力学
 * ==========
 *
 * 四条规矩，每一条都是为了「不像开关」：
 *
 * 一、惯性。新状态 = 旧状态七成 + 新判断三成。不许上一秒低落下一秒狂喜。
 * 二、冲击。被骂、被说要走这种，允许一次翻盘——人也会那样。
 * 三、基线。没人打扰的时候，慢慢回落到她自己的底色，不是回到"中性"。
 * 四、回写。她写下的念头要反过来推情绪。只做「情绪 → 念头」是投影，不是活。
 *
 * 还有一条容易被忽略：**互相抑制**。极度恐惧压不住喜悦，就不像人。
 */
import { DIM_KEYS } from './emotion-lexicon.js'

/** 平时留多少旧状态（0.7 = 七成惯性） */
export const INERTIA = 0.7

/** 冲击判定：情绪强度到这个数、或出现这些意思，就允许一次翻盘 */
export const IMPACT_INTENSITY = 0.78
const IMPACT_WORDS = [
  '走', '分开', '不要你了', '删了', '滚', '分手', '再也不', '别来了',
  // 补漏：这几句之前一条都没被算成冲击，"我要走"整句被判成平静
  '别找我', '不来了', '拉黑', '最后一句', '结束吧', '不聊了', '卸载', '没下次',
]

/** 这一句算不算强刺激 */
export function isImpact(judged, text) {
  try {
    const it = Number(judged && judged.intensity)
    if (Number.isFinite(it) && it >= IMPACT_INTENSITY) return true
  } catch {}
  const s = String(text || '')
  for (const w of IMPACT_WORDS) if (s.includes(w)) return true

  // 词表永远补不完——他要走，说法有几十种。
  // 实测：「以后我不会再来看你了可能」整句没被算成冲击，她只从 57 掉到 33，没慌。
  // 所以下面用**句式**兜：不再/别 + 来/聊/说/看/找。
  const LEAVE_PATTERNS = [
    /不(会)?再?(来|聊|说|看|找|出现)/,
    /别(再)?(来|找我|聊|出现)/,
    /(以后|今后)(都)?不(会)?(来|在|聊|找)/,
    /(最后|最后)一(次|回)/,
    /再(也)?不(见|聊|说)/,
  ]
  for (const re of LEAVE_PATTERNS) if (re.test(s)) return true

  return false
}

/**
 * 惯性混合：旧的和新的按比例揉。
 * 冲击时 inertia 降到 0.15，等于让它翻盘。
 */
export function blend(oldDims, nextDims, impact) {
  const inertia = impact ? 0.15 : INERTIA
  const out = {}
  for (const dk of DIM_KEYS) {
    const a = Number(oldDims && oldDims[dk]) || 0
    const b = Number(nextDims && nextDims[dk]) || 0
    out[dk] = Number((a * inertia + b * (1 - inertia)).toFixed(4))
  }
  return normalizeDims(out)
}

/** 归一化：八维加起来是 1（允许极小误差） */
export function normalizeDims(dims) {
  const out = {}
  let sum = 0
  for (const dk of DIM_KEYS) {
    const v = Math.max(0, Number(dims && dims[dk]) || 0)
    out[dk] = v
    sum += v
  }
  if (!sum) {
    const eq = Number((1 / DIM_KEYS.length).toFixed(4))
    for (const dk of DIM_KEYS) out[dk] = eq
    return out
  }
  for (const dk of DIM_KEYS) out[dk] = Number((out[dk] / sum).toFixed(4))
  return out
}

/**
 * 回落到基线：没人打扰的时候慢慢回她的底色，不是回"中性"。
 * rate 每 tick 拉回多少（默认 3%）。
 */
export function towardBaseline(dims, baseline, rate = 0.03) {
  const r = Math.max(0, Math.min(1, Number(rate) || 0))
  const out = {}
  for (const dk of DIM_KEYS) {
    const a = Number(dims && dims[dk]) || 0
    const b = Number(baseline && baseline[dk])
    const target = Number.isFinite(b) ? b : a
    out[dk] = Number((a + (target - a) * r).toFixed(4))
  }
  return normalizeDims(out)
}

/**
 * 互相抑制：这几组同时高就不像人。
 *
 *   不甘 + 心一动  → 不甘压心一动（心里不服气的时候，很难雀跃）
 *   乏 + 心一动  → 乏压心一动（累到提不起劲，雀跃不起来）
 *   空落落 + 不甘  → 空落落压不甘（茫然的时候连不服都想不起来）
 *
 * 只压不删——被压的还留着一点，只是抬不起头。
 */
const SUPPRESS = [
  ['unreconciled', 'flutter', 0.55],
  ['weary', 'flutter', 0.5],
  ['dazed', 'unreconciled', 0.35],
]

export function suppress(dims) {
  const out = { ...normalizeDims(dims) }
  for (const [strong, weak, k] of SUPPRESS) {
    if (!(strong in out) || !(weak in out)) continue
    if (out[strong] > 0.18 && out[weak] > 0.12) {
      const cut = out[weak] * k
      out[weak] = Number((out[weak] - cut).toFixed(4))
      out[strong] = Number((out[strong] + cut * 0.5).toFixed(4))
    }
  }
  return normalizeDims(out)
}

/**
 * 回写：她写完一句念头，情绪往那个方向偏一点。
 *
 * 这条是人最像的地方——**不是先有情绪才有话，有时候是写完那句话，人更沉了。**
 * 幅度要小（默认 0.12），否则一句日记能把她整个人翻过来。
 */
export function writeBack(dims, thoughtDim, strength = 0.12) {
  if (!thoughtDim || !DIM_KEYS.includes(thoughtDim)) return normalizeDims(dims)
  const s = Math.max(0, Math.min(1, Number(strength) || 0))
  const out = {}
  for (const dk of DIM_KEYS) out[dk] = Number(dims && dims[dk]) || 0
  // 目标那一维涨 s，其余按比例让出 s
  const others = DIM_KEYS.filter((d) => d !== thoughtDim)
  const othersSum = others.reduce((a, d) => a + out[d], 0)
  out[thoughtDim] = Number((out[thoughtDim] + s).toFixed(4))
  if (othersSum > 0) {
    for (const d of others) out[d] = Number((out[d] - out[d] * (s / othersSum)).toFixed(4))
  }
  return normalizeDims(out)
}

/** 一次完整的情绪推进：旧状态 + 新判断 → 新状态 */
export function step(oldDims, nextDims, opts = {}) {
  let d = blend(oldDims, nextDims, !!opts.impact)
  if (opts.baseline) d = towardBaseline(d, opts.baseline, opts.rate)
  d = suppress(d)
  return d
}

/** 变了多少（0..1），用来判断"是不是在慢慢滑" */
export function drift(a, b) {
  let sum = 0
  for (const dk of DIM_KEYS) sum += Math.abs((Number(b && b[dk]) || 0) - (Number(a && a[dk]) || 0))
  return Number(Math.min(1, sum / 2).toFixed(4))
}

/**
 * 挂念与疏远，落到数值上。
 * =========================
 *
 * 之前它们只变成一句话，写在注入里——那不叫情绪，那叫备注。
 *
 * 真的该发生的事：
 *   挂念高 → 失落、心疼往上走（想起他，心软）
 *   疏远高 → 闷往上走，心一动被压下去（不那么容易激动了，因为生分了）
 *
 * 注意：疏远**不许**把失落也压掉——人疏远了还是会想，只是不再扑上去。
 */
export function applyAbsence(dims, opts) {
  const y = Math.max(0, Math.min(1, Number(opts && opts.yearning) || 0))
  const e = Math.max(0, Math.min(1, Number(opts && opts.estrangement) || 0))
  const out = {}
  for (const dk of DIM_KEYS) out[dk] = Number(dims && dims[dk]) || 0
  if (y > 0) {
    out.wistful += 0.10 * y
    out.tender += 0.05 * y
  }
  if (e > 0) {
    out.lonely += 0.12 * e
    out.flutter *= Math.max(0, 1 - 0.55 * e)
    out.calm *= Math.max(0, 1 - 0.25 * e)
  }
  return normalizeDims(out)
}
