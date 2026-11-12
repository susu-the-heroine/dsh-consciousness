/**
 * 丢在哪：目标没进候选，还是进了排错
 * ==================================
 *
 * 2026-11-12：头名 58%、前三 72%——差距说明有一批是"排在第二三"，也有一批"根本没进来"。
 * 这两种病改法完全不同，先分清再动手。
 *
 * 跑法：node scripts/analyze-misses.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const setPath = join(HERE, 'data', 'recall-set-v2.json')
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())
const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const data = S.readSea('main')
const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))

const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const cases = (set.cases || []).filter((c) => c && c.q && c.want != null)

const idsOf = (res) => {
  const txt = String((res && res.log) || '')
  const out = []
  const re = /·\s*#(\d+)/g
  let m
  while ((m = re.exec(txt))) out.push(Number(m[1]))
  return out
}

const notIn = []     // 目标没进候选
const misRank = []   // 进了但没排第一
for (const c of cases) {
  let res = null
  try { res = await T.searchTool.execute({ query: c.q, limit: 10 }) } catch { res = { log: '' } }
  const ids = idsOf(res)
  const at = ids.indexOf(c.want)
  if (at === 0) continue
  const p = byId.get(c.want)
  const title = String((p && p.title) || '').slice(0, 30)
  if (at < 0) notIn.push({ q: c.q, want: c.want, title, got: ids.slice(0, 3) })
  else misRank.push({ q: c.q, want: c.want, title, at: at + 1, got: ids[0] })
}

console.log(`目标 ${cases.length} · 没进候选 ${notIn.length} · 进了排错 ${misRank.length}`)
console.log('')
console.log('— 没进候选（要改的是"谁进得来"）—')
for (const x of notIn) console.log(`  ${x.q} → 想要 #${x.want} ${x.title}｜给的 ${x.got.join(',')}`)
console.log('')
console.log('— 进了但排错（要改的是"怎么排"）—')
for (const x of misRank) console.log(`  ${x.q} → 想要 #${x.want} 排第 ${x.at}｜第一名是 #${x.got}`)

writeFileSync(join(HERE, 'data', 'miss-analysis.json'), JSON.stringify({ notIn, misRank }, null, 1), 'utf8')
console.log('')
console.log('已存 data/miss-analysis.json')
