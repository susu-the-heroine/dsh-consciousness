/**
 * 注入体积上限的测试
 * =================
 * 跑法：node test/cap.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { capParts, hasMustKeep, MAX_CHARS } = await import(BASE + 'lib/cap.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n体积上限：')

// 正常情况：不超就不动
const small = ['【识海 · 记忆上下文】', '【她这会儿】挺生气', '一句话']
const r1 = capParts(small)
ok(!r1.truncated, '没超 → 不截')
ok(r1.parts.length === small.length, '段落一个不少')
ok(hasMustKeep(r1.parts).length === 0, '必保块都在')

// 超了：截，并且末行说清楚
const long = ['【识海 · 记忆上下文】', '【她这会儿】' + '啊'.repeat(300)]
for (let i = 0; i < 30; i++) long.push('记忆' + i + '：' + '内'.repeat(90))
const r2 = capParts(long, 2200)
ok(r2.truncated, '超了就截')
ok(r2.parts.join('\n').length <= 2200, '截完不超过上限', String(r2.parts.join('\n').length))
ok(r2.parts[r2.parts.length - 1].includes('后面的先不塞了'), '末行说清了为什么短')
ok(r2.parts[1].startsWith('【她这会儿】'), '【她这会儿】还在（先保命）')

// 上限正好卡住时不该多塞
const exact = ['x'.repeat(100)]
const r3 = capParts(exact, 100)
ok(r3.truncated === false || r3.parts[0].length === 100, '正好等于上限时有确定行为')

// 空数组
const r4 = capParts([])
ok(r4.parts.length === 0 && !r4.truncated, '空输入不炸')

// 非数组
const r5 = capParts(null)
ok(Array.isArray(r5.parts) && r5.parts.length === 0, '传 null 也不炸')

// 默认上限就是 2200
ok(MAX_CHARS === 2200, '默认上限是 2200')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
