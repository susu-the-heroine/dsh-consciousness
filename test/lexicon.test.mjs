/**
 * 情绪词库的测试
 * ==============
 *
 * 这一层是地基：51 个名字必须一个不落地挂到八维上，否则自心模式算出来的
 * 「她这会儿安宁」在某些输入下会凭空消失。
 *
 * 跑法：node test/lexicon.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const L = await import(BASE + 'lib/emotion-lexicon.js')
const { EMOTIONS } = await import(BASE + 'assets/emotion.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('情绪词库：')

// —— 覆盖 ——
const allKeys = Object.keys(EMOTIONS)
const covered = Object.keys(L.KEY_TO_DIM)
ok(covered.length === allKeys.length, '51 个词全部有归属', covered.length + '/' + allKeys.length)
ok(L.KEY_FALLBACK.length === 0, '没有靠距离兜底的词（全靠手写）', L.KEY_FALLBACK.join(','))
ok(L.DIM_KEYS.length === 8, '正好八维', String(L.DIM_KEYS.length))

// —— 每个维度都得有底色词，否则那一维永远激活不了 ——
const emptyDims = L.DIM_KEYS.filter((dk) => L.DIM_TO_KEYS[dk].length === 0)
ok(emptyDims.length === 0, '每个维度都至少挂了一个底色词', emptyDims.join(','))

// —— 不能一个词挂两个维度 ——
const dupes = []
const seen = new Set()
for (const [k] of Object.entries(L.KEY_TO_DIM)) {
  if (seen.has(k)) dupes.push(k)
  seen.add(k)
}
ok(dupes.length === 0, '没有词被挂到两个维度', dupes.join(','))

// —— 投影：加起来约等于 1 ——
const p1 = L.project({ v: -0.2, a: 0.1, d: -0.2 })
const sum = Object.values(p1).reduce((a, b) => a + b, 0)
ok(Math.abs(sum - 1) < 0.01, '八维加起来约等于 1', sum.toFixed(4))

// —— 投影：不是赢家通吃，可以同时有几个高的 ——
const high = Object.values(p1).filter((v) => v >= 0.12).length
ok(high >= 2, '至少两维同时有值（情绪可以并存）', '同时高的有 ' + high + ' 维')

// —— 三个典型场景该落到该落的维度 ——
const calmTop = L.dominantDim(L.project({ v: 0.35, a: 0.1, d: 0.2 }))
ok(calmTop === 'calm', '平静 → 安宁', calmTop)

const emptyTop = L.dominantDim(L.project({ v: -0.2, a: 0.08, d: -0.2 }))
ok(emptyTop === 'lonely', '空落 → 寥寂', emptyTop)

const scoldTop = L.dominantDim(L.project({ v: -0.55, a: 0.7, d: -0.2 }))
ok(scoldTop === 'unreconciled', '被骂 → 不甘', scoldTop)

// —— 人话描述不能空 ——
const words = L.describeDims(p1)
ok(typeof words === 'string' && words.length >= 2, '能说出一句人话', words)

// —— 从情绪词转八维：要能用 ——
const fromKey = L.projectKey('lonely')
ok(fromKey && Math.abs(Object.values(fromKey).reduce((a, b) => a + b, 0) - 1) < 0.01, '情绪词能直接转八维')

// 词表里没有的词不能炸
const fromUnknown = L.projectKey('__not_a_real_key__')
ok(fromUnknown && L.DIM_KEYS.every((dk) => typeof fromUnknown[dk] === 'number'), '不认识的词也不炸')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
