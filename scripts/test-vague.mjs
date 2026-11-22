/**
 * 记粗：底气不足就承认底气不足
 * ========================
 *
 *   node scripts/test-vague.mjs
 *
 * 正面：可信度低 → 「印象里」「可能记岔了」；时间估的 → 说一句时间大概
 * 反面：可信度高不提、没字段不提、脏值不炸；不许把话说死，也不许说没记过
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { vagueFor } = await import(L + '/tools.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const low = vagueFor({ confidence: 0.4 })
ok('底气不足就说印象里', low.prefix === '印象里，' && /记岔/.test(low.suffix), JSON.stringify(low))

const high = vagueFor({ confidence: 0.95 })
ok('底气足就不加前缀', high.prefix === '' && high.suffix === '', JSON.stringify(high))

const est = vagueFor({ confidence: 0.9, bornEstimated: true })
ok('时间是估的就说一句', /时间大概/.test(est.suffix) && est.prefix === '', JSON.stringify(est))

ok('没字段不提', vagueFor({}).prefix === '' && vagueFor({}).suffix === '')
ok('脏值不炸', vagueFor(null).prefix === '' && vagueFor({ confidence: 'x' }).suffix === '')
ok('不把话说死', !/一定|肯定|绝对/.test(low.prefix + low.suffix))
ok('不说没记过', !/没记|不知道/.test(low.prefix + low.suffix))

console.log(`\n记粗自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
