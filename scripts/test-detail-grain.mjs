/**
 * 详略：该记清的记得清，琐事只剩个大概
 * ================================
 *
 *   node scripts/test-detail-grain.mjs
 *
 * 正面：情绪强 / 重要度高的 → 给长一点，并说「这条我记得清楚」
 * 反面：琐事不许写长；中性项不许乱贴标签；三档长度必须严格递减
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const { detailFor } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const strong = detailFor({ imp: 0.95, emo: 1 })
const strongEmo = detailFor({ imp: 0.5, emo: [-3, 0, 0, 0, 0, 0, 0, 0] })
const mid = detailFor({ imp: 0.6, emo: 0 })
const weak = detailFor({ imp: 0.2, emo: 0 })
const missing = detailFor({})

check('重要度高给长句', strong.len === 220 && /记得清楚/.test(strong.note), JSON.stringify(strong))
check('情绪强也给长句', strongEmo.len === 220 && /记得清楚/.test(strongEmo.note), JSON.stringify(strongEmo))
check('中性项不贴标签', mid.note === '' && mid.len === 110, JSON.stringify(mid))
check('琐事只给短句', weak.len === 70 && /只剩个大概/.test(weak.note), JSON.stringify(weak))
check('没写字段按中性算', missing.len === 110 && missing.note === '', JSON.stringify(missing))

check('长度严格递减', strong.len > mid.len && mid.len > weak.len, `${strong.len}/${mid.len}/${weak.len}`)
check('长句不许超过 260 字', strong.len <= 260, String(strong.len))

console.log(`\n详略自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
