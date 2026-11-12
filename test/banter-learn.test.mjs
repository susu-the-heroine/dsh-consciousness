/**
 * 用他下一步的反应改判：测试
 * ==========================
 * 这条不是"更聪明的分类器"，是"错了能自己收回"。
 * 所以测的重点是：该收回的时候收回，不该收的时候别乱收。
 *
 * 跑法：node test/banter-learn.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { reconcile, stillHot } = await import(BASE + 'lib/banter-learn.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n按后果改判：')

// 判成"真扎"，但他下一条笑呵呵 → 收回
ok(reconcile('serious', '哈哈哈行吧，你接着说').corrected === 'banter', '他下一条还笑 → 上一条是闹')
ok(reconcile('serious', '好，那你继续搞').corrected === 'banter', '他下一条没火气 → 上一条多半嘴上损')

// 判成"闹"，但他下一条更重 → 收回
ok(reconcile('banter', '你他妈真的废物').corrected === 'serious', '他下一条更重 → 上一条不是闹')

// 不该乱收
ok(reconcile('serious', '你他妈又崩了').corrected === null, '他还在火里 → 不改判')
ok(reconcile('banter', '哈哈哈').corrected === null, '都还在笑 → 不改判')
ok(reconcile('', '随便') .corrected === null, '没有上一轮判断 → 不动')

// 火气判据本身
ok(stillHot('你他妈又崩了') === true, '短、脏、没笑 → 还有火')
ok(stillHot('哈哈哈你他妈傻逼') === false, '有笑没脏字连着骂 → 不算火')
ok(stillHot('好，那你继续搞，我看着') === false, '正常接话 → 没火')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
