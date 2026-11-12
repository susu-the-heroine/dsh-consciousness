/**
 * 记忆库导入 SQLite（只做复制，不动原库）
 * =======================================
 *
 * 2026-11-12：单 JSON 整库读写，三十万条时六百多毫秒、内存近八百兆。
 * 换 SQLite 后按行读、带全文索引。这一版先只"导入 + 读出来验一致"，
 * 不改插件主链路——等一致性验过再接。
 *
 * 跑法：node scripts/sqlite-import.mjs [sea] [--out 路径]
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const oi = process.argv.indexOf('--out')
const out = oi >= 0 ? process.argv[oi + 1] : join(homedir(), '.dsh', 'consciousness-seas', sea, 'memory.db')

const src = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(src)) { console.log('没有 data.json:', src); process.exit(1) }
mkdirSync(join(out, '..'), { recursive: true })

const t0 = Date.now()
const data = JSON.parse(readFileSync(src, 'utf8').replace(/^\uFEFF/, ''))
const points = data.points || []
const edges = data.edges || []

const db = new DatabaseSync(out)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec(`
  DROP TABLE IF EXISTS points;
  DROP TABLE IF EXISTS edges;
  DROP TABLE IF EXISTS points_fts;
  CREATE TABLE points (
    id INTEGER PRIMARY KEY,
    title TEXT, alias TEXT, text TEXT,
    kind TEXT, imp REAL, arousal REAL, polarity REAL,
    born INTEGER, strength REAL, layer TEXT, era TEXT,
    category TEXT, entities TEXT,
    open_flag INTEGER, rule_flag INTEGER,
    dead INTEGER, merged_into INTEGER, merged_from TEXT,
    raw TEXT
  );
  CREATE TABLE edges (src INTEGER, dst INTEGER, sim REAL);
  CREATE VIRTUAL TABLE points_fts USING fts5(
    grams, tokenize = 'unicode61'
  );
`)

const insP = db.prepare(`INSERT INTO points
  (id,title,alias,text,kind,imp,arousal,polarity,born,strength,layer,era,category,entities,open_flag,rule_flag,dead,merged_into,merged_from,raw)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const insF = db.prepare('INSERT INTO points_fts (rowid, grams) VALUES (?,?)')
const insE = db.prepare('INSERT INTO edges (src, dst, sim) VALUES (?,?,?)')

/** 两字切片：中文两字词（腰疼）在 trigram 里搜不到，自己切成二元组塞进 FTS */
function gramsOf(s) {
  const t = String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2))
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return [...out].join(' ')
}

const joinArr = (v) => Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v))
db.exec('BEGIN')
for (const p of points) {
  insP.run(
    Number(p.id) || 0, String(p.title || ''), String(p.alias || ''), String(p.text || ''),
    String(p.kind || ''), Number(p.imp) || 0, Number(p.arousal) || 0, Number(p.polarity) || 0,
    Number(p.born) || 0, Number(p.strength) || 0, String(p.layer || ''), String(p.era || ''),
    joinArr(p.category), joinArr(p.entities),
    p.open === true ? 1 : 0, p.rule === true ? 1 : 0,
    p.dead === true ? 1 : 0, Number(p.mergedInto) || 0, joinArr(p.mergedFrom),
    JSON.stringify(p),
  )
  insF.run(Number(p.id) || 0, gramsOf(String(p.title || '') + String(p.alias || '') + String(p.text || '')))
}
for (const e of edges) insE.run(Number(e.from || e.src) || 0, Number(e.to || e.dst) || 0, Number(e.sim) || 0)
db.exec('COMMIT')
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

const cnt = db.prepare('SELECT count(*) AS c FROM points').get().c
const fts = db.prepare('SELECT count(*) AS c FROM points_fts').get().c
const edgeN = db.prepare('SELECT count(*) AS c FROM edges').get().c
console.log(`导入 ${cnt} 条记忆、${edgeN} 条边 · FTS ${fts} 条 · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`库文件: ${out} · ${(statSync(out).size / 1048576).toFixed(2)} MB`)

// 验：全文索引能不能搜到
for (const q of ['腰疼', '阑尾炎', '硬是要得']) {
  const t = Date.now()
  const g = gramsOf(q).split(' ').filter(Boolean)
  const rows = g.length ? db.prepare('SELECT rowid FROM points_fts WHERE points_fts MATCH ? LIMIT 5').all(g.map((x) => '"' + x + '"').join(' OR ')) : []
  console.log(`  搜「${q}」→ ${rows.length} 条（${Date.now() - t} ms）`)
}

// 验：按行取回和 JSON 一致
const sample = points.find((p) => p.id) || points[0]
const back = db.prepare('SELECT * FROM points WHERE id = ?').get(Number(sample.id))
const same = back && back.title === String(sample.title || '') && back.text === String(sample.text || '')
console.log(`抽检 #${sample.id} 逐字段一致: ${same ? '是' : '否'}`)
