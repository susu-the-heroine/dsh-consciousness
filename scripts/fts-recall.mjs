/**
 * 索引召回率：FTS 候选里有没有答案
 * ==============================
 *
 * 想把检索从"整库读"改成"索引出候选 → 只读那几行"，前提是索引别把对的漏掉。
 * 这个脚本就用评测题量：正确答案在 FTS 前 N 条里的比例。
 *
 * 跑法：node scripts/fts-recall.mjs [sea] [N]
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const Ns = [50, 100, 200, 500]

const M = await import('file:///' + join(HERE, '..', 'lib', 'sqlite-mirror.js').replace(/\\/g, '/') + '?v=' + Date.now())
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const dbf = join(homedir(), '.dsh', 'consciousness-seas', sea, 'memory.db')
if (!existsSync(dbf)) { console.log('没有 memory.db'); process.exit(1) }
const db = new DatabaseSync(dbf, { readOnly: true })

const set = JSON.parse(readFileSync(join(HERE, 'data', 'recall-set-v2.json'), 'utf8').replace(/^\uFEFF/, ''))
const cases = (set.cases || []).filter((c) => c && c.q && c.want != null)

function candidates(q, n) {
  const g = M.gramsOf(q).split(' ').filter(Boolean)
  if (!g.length) return []
  // 切片多了用 OR 会召回太散；这里取前 12 个片段，够用
  const expr = g.slice(0, 12).map((x) => '"' + x + '"').join(' OR ')
  try {
    return db.prepare('SELECT rowid FROM points_fts WHERE points_fts MATCH ? LIMIT ?').all(expr, n).map((r) => Number(r.rowid))
  } catch { return [] }
}

const hits = new Map(Ns.map((n) => [n, 0]))
let none = 0
for (const c of cases) {
  const want = Number(c.want)
  const also = Array.isArray(c.also) ? c.also.map(Number) : []
  const wantSet = [want, ...also]
  let found = false
  for (const n of Ns) {
    const ids = candidates(c.q, n)
    if (ids.some((id) => wantSet.includes(id))) { hits.set(n, hits.get(n) + 1); found = true }
  }
  if (!found) none++
}

console.log(`海 ${sea} · 题 ${cases.length} · 索引候选里含答案的比例：`)
for (const n of Ns) console.log(`  前 ${n} 条：${hits.get(n)}/${cases.length}（${((hits.get(n) / cases.length) * 100).toFixed(0)}%）`)
console.log(`  一个都没进（哪怕前 500）：${none} 道`)
db.close()
