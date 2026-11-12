/**
 * 候选覆盖率：索引 + 向量近邻，合起来能不能把答案带进来
 * ====================================================
 *
 * 单靠 FTS 只有 93%（四道纯语义题永远进不来）。真实检索里还有一路向量，
 * 那一路不看字面、只看意思，正好补这个洞。这个脚本量的是两路合并后的覆盖率——
 * 也就是"改成先出候选、再只读这几行"这条路，理论上能保住多少答案。
 *
 * 跑法：node scripts/candidate-coverage.mjs [sea]
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const M = await import('file:///' + join(HERE, '..', 'lib', 'sqlite-mirror.js').replace(/\\/g, '/') + '?v=' + Date.now())
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const vecs = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8').replace(/^\uFEFF/, ''))
const ids = Object.keys(vecs).map(Number)
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const db = new DatabaseSync(join(dir, 'memory.db'), { readOnly: true })

const set = JSON.parse(readFileSync(join(HERE, 'data', 'recall-set-v2.json'), 'utf8').replace(/^\uFEFF/, ''))
const cases = (set.cases || []).filter((c) => c && c.q && c.want != null)

function ftsIds(q, n) {
  const g = M.gramsOf(q).split(' ').filter(Boolean).slice(0, 12)
  if (!g.length) return []
  try {
    return db.prepare('SELECT rowid FROM points_fts WHERE points_fts MATCH ? LIMIT ?')
      .all(g.map((x) => '"' + x + '"').join(' OR '), n).map((r) => Number(r.rowid))
  } catch { return [] }
}

const Ks = [50, 100, 200]
const cover = new Map()
for (const k of Ks) cover.set(k, { fts: 0, union: 0 })

for (const c of cases) {
  const want = [Number(c.want), ...(Array.isArray(c.also) ? c.also.map(Number) : [])]
  const qv = await E.embedLocal(c.q)
  const ranked = ids
    .map((id) => { const r = vecs[String(id)]; const v = Array.isArray(r) ? r : r.v; return { id, s: v ? V.cosine(qv, v) : -1 } })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id)
  for (const k of Ks) {
    const f = ftsIds(c.q, k)
    const u = new Set([...f, ...ranked.slice(0, k)])
    const row = cover.get(k)
    if (f.some((id) => want.includes(id))) row.fts++
    if ([...u].some((id) => want.includes(id))) row.union++
  }
}
console.log(`海 ${sea} · 题 ${cases.length}`)
for (const k of Ks) {
  const r = cover.get(k)
  console.log(`  取前 ${k}：只索引 ${r.fts}（${((r.fts / cases.length) * 100).toFixed(0)}%）· 索引∪向量 ${r.union}（${((r.union / cases.length) * 100).toFixed(0)}%）`)
}
db.close()
