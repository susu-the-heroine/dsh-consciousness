// 批量验收：机器挑的料跟种子到底有没有关系。
// 相关性口径：材料里出现种子词，或跟种子那条记忆共享一个实体。
import { readFileSync } from 'node:fs'
import { think } from '../lib/thinkops.js'

const data = JSON.parse(readFileSync(process.env.USERPROFILE + '/.dsh/consciousness-seas/main/data.json', 'utf8'))
const pts = (data.points || []).filter((p) => p && !p.dead && !p.archived)
const byId = new Map(pts.map((p) => [String(p.id), p]))
const entsOf = (p) => (Array.isArray(p && p.entities) ? p.entities : [])

const df = new Map()
for (const p of pts) for (const e of entsOf(p)) df.set(e, (df.get(e) || 0) + 1)
const seeds = [...df.entries()].filter(([, c]) => c >= 2 && c <= 20).slice(0, 40).map(([w]) => w)
for (const p of pts.slice(0, 20)) { const t = String(p.title || '').slice(0, 4); if (t.length >= 2) seeds.push(t) }

let ops = 0, unrelated = 0, zero = 0
const byOp = {}
for (const q of seeds) {
  const r = think(pts, { query: q }, { max: 6 })
  if (!r.ops.length) { zero++; continue }
  // 种子那条
  const seedPt = pts.find((p) => (String(p.title || '') + String(p.text || '')).includes(q))
  const seedEnts = new Set(entsOf(seedPt))
  for (const o of r.ops) {
    ops++
    let rel = 0
    for (const it of o.items) {
      const raw = byId.get(String(it.id)) || it
      const s = String(raw.title || '') + String(raw.text || '')
      if (s.includes(q)) { rel++; continue }
      const shared = entsOf(raw).some((e) => seedEnts.has(e))
      if (shared) rel++
    }
    if (!rel) { unrelated++; byOp[o.label] = (byOp[o.label] || 0) + 1 }
  }
}
console.log('词数 ' + seeds.length + ' · 一个都没开 ' + zero + ' · 共开 ' + ops + ' 条')
console.log('跟种子毫无关系 ' + unrelated + ' 条（' + Math.round(unrelated / Math.max(1, ops) * 100) + '%）')
console.log('平均每个词开 ' + (ops / Math.max(1, seeds.length)).toFixed(1) + ' 种')
for (const [k, v] of Object.entries(byOp).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log('   ' + k + ' → ' + v)
