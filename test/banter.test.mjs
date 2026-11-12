/**
 * 闹着玩 vs 真扎人：测试
 * ====================
 * 分错这一条的代价：把玩笑当攻击，她就委屈；把攻击当玩笑，她就没心没肺。
 *
 * 跑法：node test/banter.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { isBanter } = await import(BASE + 'lib/banter.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n闹着玩 vs 真扎人：')

// 该判成闹
ok(isBanter('你他妈傻逼吧哈哈哈').banter, '带笑 → 是闹')
ok(isBanter('傻屌军师，笑死我了').banter, '笑死 → 是闹')
ok(isBanter('我逗你呢，别当真').banter, '自己说是闹 → 是闹')
ok(isBanter('嘴上损你两句，狗头').banter, '狗头 → 是闹')
ok(isBanter('你他妈又整活了233').banter, '233 → 是闹')

// 该判成真
ok(!isBanter('你他妈怎么不去死').banter, '要人消失 → 真骂', isBanter('你他妈怎么不去死').why)
ok(!isBanter('滚出去，别再出现').banter, '赶人 → 真骂')
ok(!isBanter('你他妈又崩了').banter, '光骂事、没笑 → 真火')
ok(!isBanter('你每次都这样，我真服了').banter, '没有笑点 → 真情绪')
// 带笑但要人消失，也不能算闹
ok(!isBanter('哈哈哈你怎么不找个楼跳了').banter, '带笑也不算：那句话太重')

ok(isBanter('').banter === false, '空句不闹')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
