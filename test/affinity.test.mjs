/**
 * 情绪同频的测试
 * ==============
 *
 * 这一维是我们自己加的，没有现成标准，所以规矩必须钉死并测住：
 *
 *   极性不明        → 不加分（她自己都没确定是暖是冷，别装懂）
 *   极性相反        → 不加分（开心的时候不该翻出最痛的那条）
 *   强度差太远      → 不加分（都是难过，0.9 和 0.1 不是一回事）
 *   极性同号且接近  → 加分，最多 0.10
 *
 * 跑法：node test/affinity.test.mjs
 */
// 钉死上限：现场热配置改过这个数，单测不该跟着红
process.env.DSH_AFFINITY_MAX = '0.10'

const BASE = new URL('../', import.meta.url).href
const { emotionAffinity } = await import(BASE + 'lib/affinity.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps

console.log('情绪同频：')

// —— 该加分的 ——
let r = emotionAffinity({ v: -0.8, a: 0.7 }, { polarity: -1, arousal: 7 })
ok(r.bonus > 0, '憋屈 0.7 遇上当时强度 7 的负记忆 → 加分', JSON.stringify(r))
ok(near(r.bonus, 0.10), '强度完全一致 → 拿满 0.10', '实际 ' + r.bonus)
ok(r.reason.startsWith('同频'), '理由写得出来', r.reason)

r = emotionAffinity({ v: 0.6, a: 0.5 }, { polarity: 1, arousal: 6 })
ok(r.bonus > 0, '开心遇上正向记忆 → 加分')

r = emotionAffinity({ v: -0.8, a: 0.7 }, { polarity: -1, arousal: 3 })
ok(r.bonus > 0 && r.bonus < 0.10, '强度差 4 → 加分但不满', '实际 ' + r.bonus.toFixed(3))

// —— 不该加分的 ——
r = emotionAffinity({ v: -0.8, a: 0.7 }, { polarity: 1, arousal: 7 })
ok(r.bonus === 0, '憋屈遇上一件喜事 → 不加分（不许翻出相反的）')

r = emotionAffinity({ v: -0.05, a: 0.7 }, { polarity: -1, arousal: 7 })
ok(r.bonus === 0, '极性不明（|v|=0.05）→ 不加分')

r = emotionAffinity({ v: 0, a: 0.5 }, { polarity: -1, arousal: 5 })
ok(r.bonus === 0, '完全中性 → 不加分')

r = emotionAffinity({ v: -0.9, a: 0.9 }, { polarity: -1, arousal: 1 })
ok(r.bonus === 0, '强度差 8（0.9 对 0.1）→ 不加分')

r = emotionAffinity({ v: -0.9, a: 0.9 }, { polarity: 0, arousal: 9 })
ok(r.bonus === 0, '这条没标极性 → 不加分')

r = emotionAffinity(null, { polarity: -1, arousal: 5 })
ok(r.bonus === 0, '心脏读不出来 → 不加分，也不报错')

r = emotionAffinity({ v: -0.9, a: 0.9 }, { polarity: -1 })
ok(r.bonus === 0, '这条没记强度 → 不加分')

// —— 上限守死：不许大到绑架检索 ——
r = emotionAffinity({ v: -1, a: 1 }, { polarity: -1, arousal: 10 })
ok(r.bonus <= 0.10, '加成封顶 0.10', '实际 ' + r.bonus)

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
