/**
 * JSON 与 SQLite 一致性检查
 * ========================
 *
 * 双写之后，两份会慢慢漂：JSON 改了没镜像、镜像写过又回滚、条数不同。
 * 切读之前必须先证明"两边一模一样"，否则切过去就是换一种丢记忆的方式。
 *
 * 跑法：node scripts/sqlite-parity.mjs [sea]
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const jsonFile = join(dir, 'data.json')
const dbFile = join(dir, 'memory.db')
if (!existsSync(jsonFile)) { console.log('没有 data.json'); process.exit(1) }
if (!existsSync(dbFile)) { console.log('没有 memory.db'); process.exit(1) }

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const data = JSON.parse(readFileSync(jsonFile, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || [])
const db = new DatabaseSync(dbFile, { readOnly: true })
const rows = db.prepare('SELECT * FROM points').all()
db.close()

const jm = new Map(pts.map((p) => [Number(p.id), p]))
const sm = new Map(rows.map((r) => [Number(r.id), r]))

const onlyJson = [...jm.keys()].filter((k) => !sm.has(k))
const onlyDb = [...sm.keys()].filter((k) => !jm.has(k))
const cmpFields = [
  ['title', (p) => String(p.title || '')],
  ['alias', (p) => String(p.alias || '')],
  ['text', (p) => String(p.text || '')],
  ['imp', (p) => Number(p.imp) || 0],
  ['arousal', (p) => Number(p.arousal) || 0],
  ['polarity', (p) => Number(p.polarity) || 0],
  ['born', (p) => Number(p.born) || 0],
  // 强度会被后台心跳改（只改 JSON，不镜像）。所以它单独算"漂移"，不算不一致。
  ['strength', (p) => Number(p.strength) || 0],
  ['layer', (p) => String(p.layer || '')],
  ['era', (p) => String(p.era || '')],
  ['open', (p) => (p.open === true ? 1 : 0)],
  ['rule', (p) => (p.rule === true ? 1 : 0)],
  ['dead', (p) => (p.dead === true ? 1 : 0)],
]
const SOFT = new Set(['strength', 'arousal', 'polarity', 'open'])  // 心跳会改的字段。写库总入口已经挂着镜像，所以正常情况下它们也该是 0 处
const diffs = []
const soft = []
for (const [id, p] of jm) {
  const r = sm.get(id)
  if (!r) continue
  for (const [name, get] of cmpFields) {
    const jv = get(p)
    const sv = r[name === 'open' ? 'open_flag' : name === 'rule' ? 'rule_flag' : name]
    const a = typeof jv === 'number' ? Number(jv) : String(jv)
    const b = typeof jv === 'number' ? Number(sv) || 0 : String(sv == null ? '' : sv)
    if (a !== b) {
      const item = { id, field: name, json: String(a).slice(0, 24), sqlite: String(b).slice(0, 24) }
      if (SOFT.has(name)) soft.push(item)
      else diffs.push(item)
    }
  }
}

const alive = pts.filter((p) => !p.dead).length
console.log(`海 ${sea} · JSON ${pts.length} 条（活 ${alive}）· SQLite ${rows.length} 条`)
console.log(`只在 JSON 里：${onlyJson.length}${onlyJson.length ? ' → ' + onlyJson.slice(0, 8).join(',') : ''}`)
console.log(`只在 SQLite 里：${onlyDb.length}${onlyDb.length ? ' → ' + onlyDb.slice(0, 8).join(',') : ''}`)
console.log(`结构性不一致：${diffs.length} 处（必须为 0）`)
console.log(`可漂移（强度/情绪/悬着）：${soft.length} 处（写库时已镜像；这里非零说明镜像没跟上）`)
for (const d of diffs.slice(0, 12)) console.log(`  #${d.id} ${d.field}: JSON=${d.json} · SQLite=${d.sqlite}`)
if (soft.length) console.log(`  强度漂移例：#${soft[0].id} JSON=${soft[0].json} · SQLite=${soft[0].sqlite}`)
console.log('')
console.log(diffs.length === 0 && onlyJson.length === 0 && onlyDb.length === 0
  ? '结论：两边一致，可以谈切读。'
  : '结论：不一致，先修齐再谈切读。')
process.exit(diffs.length === 0 && onlyJson.length === 0 && onlyDb.length === 0 ? 0 : 1)
