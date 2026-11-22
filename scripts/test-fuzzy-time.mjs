/**
 * 时间说法：正反两面
 * =================
 *
 *   node scripts/test-fuzzy-time.mjs
 *
 * 正面：该模糊的模糊了（不说「四天前」这种精确到天的假精确）
 * 反面：该准的还准（今天、昨天不变）；估计出来的时间还是「时间未知」，不许编
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/analysis.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const { bornLabel } = await import('file:///' + join(HERE, '..', 'lib', 'analysis.js').replace(/\\/g, '/'))

const now = Date.UTC(2026, 10, 16, 12, 0, 0)
const day = 86400000
const at = (d) => ({ born: now - d * day })

let pass = 0
let fail = 0
const check = (name, ok, got) => {
  if (ok) { pass++; console.log('  ok   ' + name + ' -> ' + got) } else { fail++; console.log('  FAIL ' + name + ' -> ' + got) }
}

// 正面
check('0 天说今天', bornLabel(at(0), now) === '今天', bornLabel(at(0), now))
check('1 天说昨天', bornLabel(at(1), now) === '昨天', bornLabel(at(1), now))
check('2 天说前两天', bornLabel(at(2), now) === '前两天', bornLabel(at(2), now))
check('5 天说前几天', bornLabel(at(5), now) === '前几天', bornLabel(at(5), now))
check('10 天说上周', bornLabel(at(10), now) === '上周', bornLabel(at(10), now))
check('20 天说半个月', bornLabel(at(20), now) === '大概半个月前', bornLabel(at(20), now))
check('40 天说上个月', bornLabel(at(40), now) === '上个月', bornLabel(at(40), now))
check('90 天给日期', /^\d{4}-\d{2}-\d{2}$/.test(bornLabel(at(90), now)), bornLabel(at(90), now))

// 反面
check('不许出现「5 天前」这种', !/\d+\s*天前/.test(bornLabel(at(5), now)), bornLabel(at(5), now))
check('两天不许说今天', bornLabel(at(2), now) !== '今天', bornLabel(at(2), now))
check('估的时间仍说未知', bornLabel({ born: now - 3 * day, bornEstimated: true }, now) === '时间未知', bornLabel({ born: now - 3 * day, bornEstimated: true }, now))
check('没时间仍说未知', bornLabel({}, now) === '时间未知', bornLabel({}, now))

console.log(`\n时间说法自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
