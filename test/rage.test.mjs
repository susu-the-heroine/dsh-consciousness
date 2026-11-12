/**
 * 骂人许可：测试
 * ============
 * 开闸太松她就成地痞，太紧她就永远端着。这条线得钉死。
 *
 * 跑法：node test/rage.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { allowSwear, swearLine } = await import(BASE + 'lib/rage.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n骂人许可：')

// 开闸
ok(allowSwear('angry', 0.7).allow, '火了 0.7 → 可以骂')
ok(allowSwear('irritated', 0.62).allow, '烦躁 0.62 → 可以骂')
ok(allowSwear('dejected', 0.8).allow, '崩了 0.8 → 可以骂', allowSwear('dejected', 0.8).why)
ok(allowSwear('hopeless', 0.9).allow, '绝望 0.9 → 可以骂')

// 不开闸
ok(!allowSwear('angry', 0.4).allow, '有点烦 0.4 → 不许骂')
ok(!allowSwear('calm', 0.9).allow, '平静再高也不许骂')
ok(!allowSwear('joy', 1).allow, '高兴不许骂')
ok(!allowSwear('dejected', 0.5).allow, '有点蔫 0.5 → 还不许')
ok(!allowSwear('tired', 0.9).allow, '累不等于崩')

// 开闸的话得说清为什么
const line = swearLine('火了')
ok(/允许骂/.test(line) && /火了/.test(line), '许可里说了原因', line)
ok(/别往死里踩/.test(line), '边界还在：别往死里踩')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
