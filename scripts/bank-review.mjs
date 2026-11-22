/**
 * 看题库：一条问法 + 当时排前面的记忆标题
 * ==================================
 *
 *   node scripts/bank-review.mjs [识海] [从几号开始] [看几条]
 *
 * 只读，不改。标注还是人来打——这个脚本只是把"要判断的材料"摆到眼前，
 * 省得一边翻 data.json 一边猜编号。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'main').trim() || 'main'
const from = Math.max(0, Number(process.argv[3]) || 0)
const take = Math.max(1, Math.min(60, Number(process.argv[4]) || 15))

const bankPath = join(HERE, 'data', 'query-bank.jsonl')
const dataPath = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(bankPath)) { console.log('没有题库，先跑 build-query-bank.mjs'); process.exit(1) }
if (!existsSync(dataPath)) { console.log('没有这个识海：' + sea); process.exit(1) }

const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))
const titleOf = (id) => {
  const p = byId.get(Number(id))
  if (!p) return `#${id}(不在了)`
  const t = String(p.title || p.text || '').slice(0, 28).replace(/\s+/g, ' ')
  return `#${id} ${t}`
}

const rows = readFileSync(bankPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const slice = rows.slice(from, from + take)
console.log(`共 ${rows.length} 条（${from}–${from + slice.length - 1}）`)
slice.forEach((r, i) => {
  console.log(`\n[${from + i}] ${r.q}`)
  console.log('    当时第一：' + (r.top ? titleOf(r.top) : '无'))
  for (const id of (r.core || []).slice(1, 3)) console.log('    当时其后：' + titleOf(id))
})
// 2026-11-21：原来叫人「把 top 改成应该中的编号」——可评估那份只认 want 这个字段，
// 照这话标出来的题一条都用不上（实测那份文件就是因此成了「题 0」）。
// 字段名得说准，不然白标一遍。
console.log('\n标注：每条加一个 want 字段，填"应该中的编号"（跟 q 并排，别改 top——top 是当时排第一的，留着做对照）。')
console.log('存成 scripts/data/labeled-batch.json，评估脚本只认 want 这个字段名。')
console.log('聊天类（继续 / 你咋又停了）没有该中的记忆，标 null——这也是数据。')
