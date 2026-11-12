/**
 * 情绪动力学的测试
 * ================
 *
 * 四条规矩各测一遍，外加「不许一秒变脸」和「抑制方向不能反」。
 * 跑法：node test/dynamics.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const D = await import(BASE + 'lib/dynamics.js')
const L = await import(BASE + 'lib/emotion-lexicon.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const sum = (d) => Object.values(d).reduce((a, b) => a + b, 0)
const peaks = (d) => L.DIM_KEYS.filter((k) => d[k] > 0.15)

console.log('动力学：')

// —— 归一化 ——
const flat = D.normalizeDims({ calm: 1, lonely: 1, wistful: 0 })
ok(Math.abs(sum(flat) - 1) < 0.01, '归一化后总和为 1', sum(flat).toFixed(4))
const zeros = D.normalizeDims({})
ok(Math.abs(sum(zeros) - 1) < 0.01 && L.DIM_KEYS.every(k => zeros[k] > 0), '全零时给均匀分布，不除零')

// —— 惯性：不许一秒变脸 ——
const old1 = L.project({ v: 0.35, a: 0.10, d: 0.20 })     // 安宁
const next1 = L.project({ v: -0.35, a: 0.30, d: 0.35 })   // 不甘
const mixed = D.blend(old1, next1, false)
const moved = D.drift(old1, mixed)
ok(moved < 0.5, '一次普通变化挪不到一半（惯性在）', moved.toFixed(3))
ok(mixed.calm > next1.calm, '旧状态还留着一些（安宁没被抹掉）')

// —— 冲击：允许翻盘 ——
const slam = D.blend(old1, next1, true)
ok(D.drift(old1, slam) > D.drift(old1, mixed), '强刺激挪得比普通变化多', D.drift(old1, slam).toFixed(3))
ok(D.isImpact({ intensity: 0.9 }, ''), '强度 0.9 判为冲击')
ok(D.isImpact(null, '你要是这样我就走了'), '「走了」判为冲击')
ok(!D.isImpact({ intensity: 0.3 }, '今天吃啥'), '普通一句不是冲击')

// —— 基线：往她自己的底色回，不是回中性 ——
const baseline = L.project({ v: -0.25, a: 0.08, d: -0.20 })  // 她底色偏寥寂
const excited = L.project({ v: 0.30, a: 0.38, d: 0.10 })     // 一时悸动
let cur = excited
for (let i = 0; i < 40; i++) cur = D.towardBaseline(cur, baseline, 0.1)
ok(cur.lonely > excited.lonely, '安静久了，寥寂会涨起来')
ok(cur.flutter < excited.flutter, '悸动会退下去')
ok(Math.abs(sum(cur) - 1) < 0.01, '回落过程里总和仍然是 1')

// —— 抑制：方向不能反 ——
const bothHigh = D.suppress(D.normalizeDims({ unreconciled: 0.4, flutter: 0.4, calm: 0.2 }))
ok(bothHigh.flutter < bothHigh.unreconciled, '不甘压住了悸动', bothHigh.flutter + ' vs ' + bothHigh.unreconciled)

const wearyFlutter = D.suppress(D.normalizeDims({ weary: 0.4, flutter: 0.4, calm: 0.2 }))
ok(wearyFlutter.flutter < 0.4, '倦怠也压悸动')
ok(wearyFlutter.flutter > 0, '压了但没删光')

// 该留的时候要留：单高不触发抑制
const single = D.suppress(D.normalizeDims({ flutter: 0.8, calm: 0.2 }))
ok(single.flutter > 0.6, '只有悸动高时不该被压', single.flutter.toFixed(3))

// —— 回写：写完那句话，情绪跟着偏 ——
const before = L.project({ v: 0, a: 0.1, d: 0 })
const after = D.writeBack(before, 'lonely', 0.15)
ok(after.lonely > before.lonely, '写完寥寂的念头，会更寥寂')
ok(Math.abs(sum(after) - 1) < 0.01, '回写后总和仍是 1')

// 幅度要小：一句日记不该翻天
const small = D.writeBack(before, 'lonely', 0.12)
ok(D.drift(before, small) < 0.25, '一句念头的影响小于四分之一', D.drift(before, small).toFixed(3))

// 不认识的维度不能炸
ok(collapseSafe(), '不认识的维度不炸')

function collapseSafe() {
  const r = D.writeBack(before, '不存在的维度', 0.1)
  return r && Math.abs(sum(r) - 1) < 0.01
}

// —— 完整推进 ——
const s1 = D.step(old1, next1, { baseline, rate: 0.05 })
ok(Math.abs(sum(s1) - 1) < 0.01, 'step 之后仍然是合法状态')
ok(D.drift(old1, s1) < 0.6, 'step 不会让一次普通输入就换个人')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
console.log('\n离开的说法（词表兜不住，靠句式）：')
{
  const D = await import(BASE + 'lib/dynamics.js')
  const M = await import(BASE + 'lib/mood.js')
  const yes = ['以后我不会再来看你了可能', '别再来找我', '再也不会跟你聊了', '这是最后一次', '我走了']
  const no = ['别说话', '别看了', '你说得对', '我今天好累', '快点把素材录了']
  let okAll = true
  for (const c of yes) {
    const got = D.isImpact(M.judgeEmotion(c), c)
    if (!got) { okAll = false; console.log('  ✗ 该算冲击却没算:', c) }
  }
  ok(okAll, '离开的十种说法都算冲击')
  for (const c of no) {
    const got = D.isImpact(M.judgeEmotion(c), c)
    if (got) { okAll = false; console.log('  ✗ 不该算冲击却算了:', c) }
  }
  ok(okAll, '日常话不被误判成离开')
}

