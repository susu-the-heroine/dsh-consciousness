/**
 * 被盖过的牌子
 * ==========
 *
 *   node scripts/test-supersede.mjs
 *
 * 正面：旧条带了盖过标记 → 挂一句叮嘱，不删、不骂
 * 反面：没标记不提；0/负数/脏值不提；同一条不许自己盖自己
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { supersededNote } = await import(LIB + '/tools.js')
const { applyConflict } = await import(LIB + '/writer-js.js')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const hit = supersededNote({ supersededBy: 42 })
check('有标记就挂一句', /后来被新的盖过/.test(hit), hit)
check('不骂、不替人删', !/删掉|作废|别信/.test(hit), hit)

check('没标记不提', supersededNote({}) === '')
check('零不算', supersededNote({ supersededBy: 0 }) === '')
check('负数不算', supersededNote({ supersededBy: -3 }) === '')
check('字符串数字算', /盖过/.test(supersededNote({ supersededBy: '7' })))
check('脏值不炸', supersededNote(null) === '' && supersededNote({ supersededBy: 'x' }) === '')

// 自己盖自己：applyConflict 里那条保护
const points = [{ id: 5, title: '同一条', text: '同一条' }]
const selfPoint = { id: 5, title: '同一条', text: '同一条' }
const c = applyConflict(selfPoint, points)
check('自己盖自己不许标', !c || !c.supersededBy, JSON.stringify(c && c.supersededBy))

console.log(`\n被盖过自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
