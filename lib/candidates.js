/**
 * 候选：两路合起来，把该看的记忆缩小到一两百条
 * ============================================
 *
 * 拆开量过：只靠全文索引能带回 93%（四道纯语义题永远进不来）；索引 ∪ 向量近邻是 100%。
 * 所以这个模块干一件事：给一句话，回一批编号。
 *
 * 规矩：
 *   - 只读不写；
 *   - 任何一路出错都不许让整体失败（另一路照样给）；
 *   - 候选太少就返回空数组，让上层的"整库扫"兜底。
 *
 * 2026-11-12 起，还没接进检索——先有零件、有自测，再接。
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { gramsOf } from './sqlite-mirror.js'

const require = createRequire(import.meta.url)
const SEAS_DIR = join(homedir(), '.dsh', 'consciousness-seas')

let _dbs = new Map()
function dbOf(sea) {
  if (_dbs.has(sea)) return _dbs.get(sea)
  let db = null
  try {
    const f = join(SEAS_DIR, sea, 'memory.db')
    if (existsSync(f)) db = new (require('node:sqlite').DatabaseSync)(f, { readOnly: true })
  } catch { db = null }
  _dbs.set(sea, db)
  return db
}

/** 全文那一路：两字/三字切片进 FTS */
export function ftsCandidates(sea, query, n = 60) {
  try {
    const db = dbOf(sea)
    if (!db) return []
    const g = gramsOf(query).split(' ').filter(Boolean).slice(0, 12)
    if (!g.length) return []
    const expr = g.map((x) => '"' + x + '"').join(' OR ')
    return db.prepare('SELECT rowid FROM points_fts WHERE points_fts MATCH ? LIMIT ?').all(expr, n).map((r) => Number(r.rowid))
  } catch { return [] }
}

/** 向量那一路：拿问句跟库里向量比，取最近的 n 条 */
export async function vectorCandidates(sea, query, n = 60) {
  try {
    const vf = join(SEAS_DIR, sea, 'vectors.json')
    if (!existsSync(vf)) return []
    const raw = JSON.parse(readFileSync(vf, 'utf8'))
    const E = await import('./embed-onnx.js')
    const V = await import('./vectors.js')
    const qv = await E.embedLocal(query)
    if (!qv || !qv.length) return []
    const scored = []
    for (const [id, obj] of Object.entries(raw)) {
      const v = Array.isArray(obj) ? obj : obj && obj.v
      if (!v) continue
      scored.push({ id: Number(id), s: V.cosine(qv, v) })
    }
    scored.sort((a, b) => b.s - a.s)
    return scored.slice(0, n).map((x) => x.id)
  } catch { return [] }
}

/** 两路合并去重；少于 min 条就返回空，让上层整库扫 */
export async function candidatesFor(sea, query, opts = {}) {
  const n = Number(opts.n) || 60
  const min = Number(opts.min) || 20
  const f = ftsCandidates(sea, query, n)
  const v = await vectorCandidates(sea, query, n)
  const set = new Set([...f, ...v])
  if (set.size < min) return []
  return [...set]
}

export function closeCandidates() {
  for (const [, db] of _dbs) { try { db && db.close() } catch {} }
  _dbs = new Map()
}
