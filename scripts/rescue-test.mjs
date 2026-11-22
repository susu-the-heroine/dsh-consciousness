/**
 * 归档了，也得让人知道"有过这块"
 * ==============================
 *
 *   node scripts/rescue-test.mjs
 *
 * 归档的条目按设计不进检索。但"沉下去了"和"从来没记过"长得很像。
 * 所以问的时候要留一句人话：这块我记着有过东西，X 天前沉下去了。
 *
 * 只读。拿归档条的标题原话去问，验两件事：
 *   1) 那条不许被当成活记忆列出来；
 *   2) 日志里得有一句"沉下去了"的提示。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))

const data = S.readSea('main')
const all = (data.points || []).filter((p) => !p.dead)
const archived = all.filter((p) => p.archived)

// 2026-11-21：原来没归档时印一句「不用验」就退零——退零等于说「过了」，
// 可这一条根本没测。今晚见过太多「没测到当通过」，这里改成退二，把话说清。
if (!archived.length) {
  console.log('主库没有归档的，这条没测到——不算通过。')
  console.log('要验它，得先有一条沉下去的（memory_archive 扫一遍就会有）。')
  process.exit(2)
}

let bad = 0
for (const p of archived) {
  const q = String(p.title || '').trim()
  if (!q) continue
  const r = await T.searchTool.execute({ sea: 'main', query: q })
  const log = String((r && (r.log || r.text)) || '')
  const leaked = new RegExp('^ *· #' + p.id + '( |$)', 'm').test(log)
  const hinted = /沉下去|归档/.test(log)
  if (leaked) { bad++; console.log(`挂  #${p.id} 被当成活记忆列出来了`) }
  else if (!hinted) { bad++; console.log(`挂  #${p.id} 沉了，但没给一句提示`) }
  else console.log(`过  #${p.id} 沉着的，提了一句`)
}

console.log(bad ? `不对：${bad} 条。` : '归档的不冒充活记忆，但会告诉你"有过这块"。')
process.exit(bad ? 1 : 0)
