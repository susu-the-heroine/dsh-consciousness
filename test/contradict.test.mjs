/**
 * 冲突判定：测试
 * =============
 * 这层只标不改。所以测试盯两件事：该标的标上，不该标的别乱标。
 *
 * 跑法：node test/contradict.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { contradicts, contentChars, hasNegation } = await import(BASE + 'lib/contradict.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n冲突判定：')

// 一、该标的标上
const SHOULD = [
  ['我不吃辣，一点辣都受不了', '我昨天吃了爆辣火锅，辣得爽'],
  ['我不抽烟', '我刚抽了一根烟'],
  ['他从来不喝酒', '他今晚喝了酒'],
]
for (const [a, b] of SHOULD) {
  const r = contradicts(a, b)
  ok(r.conflict, '该标上：「' + a.slice(0, 8) + '」vs「' + b.slice(0, 8) + '」', r.why)
}

// 二、不该标的别乱标
const SHOULD_NOT = [
  ['我不吃辣', '我喜欢吃甜的'],
  ['锅又糊了老板骂我', '锅又糊了老板骂我'],
  ['今天累死了', '明天要去学校'],
  ['我不喜欢香菜', '我不吃辣'],
]
for (const [a, b] of SHOULD_NOT) {
  const r = contradicts(a, b)
  ok(!r.conflict, '别乱标：「' + a.slice(0, 8) + '」vs「' + b.slice(0, 8) + '」', r.why)
}

// 三、字数太少不比（避免「我饿」「我不饿」这种碰瓷）
ok(!contradicts('饿', '不饿').conflict, '太短的不比')

// 四、工具函数本身
ok(hasNegation('我不去') && !hasNegation('我去'), '否定识别')
ok(contentChars('我不吃辣，一点辣都受不了').size > 2, '内容字抽得出')

// 五、共同字要露出来，方便人看
const r = contradicts('我不吃辣', '我吃爆辣火锅')
if (r.conflict) ok(r.shared.includes('辣'), '能说出共同字', r.shared.join(''))

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
