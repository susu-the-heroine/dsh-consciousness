/**
 * 「这个你问过一次」：像人一样认得重复
 * ==================================
 *
 *   node scripts/test-recall-before.mjs
 *
 * 正面：同海、同问句、两三天前问过 → 提一句，带模糊时间
 * 反面：同一天连问不提；超过三十天不提；别的海不提；问句不同不提；脏数据不炸
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/searchlog.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const { recalledBefore } = await import('file:///' + join(HERE, '..', 'lib', 'searchlog.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const now = Date.UTC(2026, 10, 16, 12)
const day = 86400000
const row = (d, q = '显卡那件事', sea = 'main') => ({ k: 's', t: now - d * day, q, sea })

const hit = recalledBefore('显卡那件事', 'main', now, [row(3)])
check('三天前提一句', /问过一次/.test(hit) && /前两天/.test(hit), JSON.stringify(hit))

const hitWeek = recalledBefore('显卡那件事', 'main', now, [row(9)])
check('九天前说是上周', /上周/.test(hitWeek), JSON.stringify(hitWeek))

check('同一天不提', recalledBefore('显卡那件事', 'main', now, [row(0)]) === '')
check('三十天前提', recalledBefore('显卡那件事', 'main', now, [row(45)]) === '')
check('别的海不算', recalledBefore('显卡那件事', 'main', now, [row(3, '显卡那件事', 'sandbox')]) === '')
check('问句不同不算', recalledBefore('显卡那件事', 'main', now, [row(3, '别的事')]) === '')
check('没记录不提', recalledBefore('显卡那件事', 'main', now, []) === '')
check('空问句不提', recalledBefore('', 'main', now, [row(3)]) === '')
check('脏数据不炸', recalledBefore('显卡那件事', 'main', now, [{ k: 's', t: 'x', q: null }, null]) === '')
check('标点差异也算同一句', /问过一次/.test(recalledBefore('显卡那件事？', 'main', now, [row(5)])), '')

console.log(`\n问过提示自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
