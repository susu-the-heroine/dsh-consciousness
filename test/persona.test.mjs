/**
 * 性格参数（基线 + 阻尼）的测试
 * ==========================
 * 跑法：node test/persona.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const P = await import(BASE + 'lib/persona.js')
const L = await import(BASE + 'lib/emotion-lexicon.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const dist = (a, b) => Math.sqrt(Object.keys(a).reduce((s, k) => s + (a[k] - (b[k] || 0)) ** 2, 0))
const start = L.project({ v: -0.1, a: 0.2, d: -0.1 })
const target = L.project({ v: -0.6, a: 0.7, d: -0.5 })

console.log('\n性格参数：')

ok(P.PERSONA_KEYS.length === 15, '十五个性格都在', String(P.PERSONA_KEYS.length))

// 一、基线偏移之后仍然是合法八维（加起来 1）
for (const k of P.PERSONA_KEYS) {
  const d = P.applyPersona(start, k, 1)
  const sum = Object.values(d).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.01) {
    ok(false, k + ' 偏移后不归一', String(sum))
    break
  }
  if (k === P.PERSONA_KEYS[P.PERSONA_KEYS.length - 1]) ok(true, '偏移后仍然是合法八维（和为 1）')
}

// 二、偏移方向对：温和的恻隐该比冷静的高
const gentle = P.applyPersona(start, 'gentle', 1)
const detachedRaw = P.applyPersona(start, 'detached', 1)
ok(gentle.tender > detachedRaw.tender, '温和的恻隐 > 冷静的恻隐',
  gentle.tender.toFixed(3) + ' vs ' + detachedRaw.tender.toFixed(3))

// 三、阻尼要单调：阻尼越大，平常推得越少
const order = P.PERSONA_KEYS.slice().sort((a, b) => P.dampOf(a) - P.dampOf(b))
let mono = true
let prev = -1
for (const k of order) {
  const m = dist(start, P.mixWithPersona(start, target, k, false))
  if (prev >= 0 && m > prev + 1e-6) { mono = false; break }
  prev = m
}
ok(mono, '阻尼越大，挪得越少（单调）')

// 四、冲击保证下限：不管多冷静，他要走都得动
const coldest = 'detached'
const normalMove = dist(start, P.mixWithPersona(start, target, coldest, false))
const impactMove = dist(start, P.mixWithPersona(start, target, coldest, true))
ok(impactMove > normalMove * 1.5, '冷静型：冲击挪得比平常明显多',
  normalMove.toFixed(3) + ' → ' + impactMove.toFixed(3))
ok(impactMove > 0.05, '冷静型：冲击也不能一动不动', impactMove.toFixed(3))

// 五、默认阻尼有值，不会 undefined
ok(P.PERSONA_KEYS.every((k) => Number.isFinite(P.dampOf(k))), '每个都有阻尼数')

// 六、描述句不带问号
ok(P.PERSONA_KEYS.every((k) => !/[？?]/.test(P.describePersona(k))), '描述句不带问号')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
