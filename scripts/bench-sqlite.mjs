/**
 * SQLite 与 JSON 对比：三十万条规模
 * =================================
 *
 * 2026-11-12 实测过 JSON 版：三万条读整库 67 ms、三十万条 658 ms、内存近 800 MB。
 * 这里在同一台机器上造同样规模，量 SQLite 的写入、按行读、全文搜。
 *
 * 跑法：node scripts/bench-sqlite.mjs [条数]
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const N = Number(process.argv[2] || 100000)
const dir = mkdtempSync(join(tmpdir(), 'sqbench-'))
const dbf = join(dir, 'b.db')

const FACT = ['在经十路骑车吹风', '录 GMod 素材摔了三次', '短视频完播率二十五个点', '阑尾炎打了八天吊针', '他说腰疼让他站起来走两圈']
function gramsOf(s) {
  const t = String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2))
  return [...out].join(' ')
}

const t0 = Date.now()
const db = new DatabaseSync(dbf)
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL')
db.exec(`CREATE TABLE points (id INTEGER PRIMARY KEY, title TEXT, text TEXT, born INTEGER, imp REAL);
         CREATE VIRTUAL TABLE points_fts USING fts5(grams, tokenize='unicode61');`)
const insP = db.prepare('INSERT INTO points (id,title,text,born,imp) VALUES (?,?,?,?,?)')
const insF = db.prepare('INSERT INTO points_fts (rowid, grams) VALUES (?,?)')
db.exec('BEGIN')
for (let i = 0; i < N; i++) {
  const title = `规模-${i}`
  const text = `第 ${i} 条：${FACT[i % FACT.length]}，序号 ${i}。`
  insP.run(i + 1, title, text, Date.now() - i * 1000, 0.6)
  if (i % 2 === 0) insF.run(i + 1, gramsOf(title + text))
}
db.exec('COMMIT')
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
const buildMs = Date.now() - t0
console.log(`造 ${N} 条（一半进索引）：${(buildMs / 1000).toFixed(1)}s · 库 ${(statSync(dbf).size / 1048576).toFixed(1)} MB`)

// 按行读
let t = Date.now()
for (let k = 0; k < 100; k++) db.prepare('SELECT * FROM points WHERE id = ?').get((k * 997) % N + 1)
console.log(`按编号读 100 条：${Date.now() - t} ms（每次 ${((Date.now() - t) / 100).toFixed(2)} ms）`)

// 全文搜
t = Date.now()
const rows = db.prepare('SELECT rowid FROM points_fts WHERE points_fts MATCH ? LIMIT 20').all(gramsOf('腰疼').split(' ').map((x) => '"' + x + '"').join(' OR '))
console.log(`全文搜「腰疼」：${Date.now() - t} ms · 命中 ${rows.length}`)

// 取最近 20 条（模拟"按时间列"）
t = Date.now()
db.prepare('SELECT id,title FROM points ORDER BY born DESC LIMIT 20').all()
console.log(`按时间取 20 条：${Date.now() - t} ms`)

// 对比：同样数据写一份 JSON 再读
const all = db.prepare('SELECT id,title,text,born,imp FROM points').all()
t = Date.now()
const jf = join(dir, 'b.json')
writeFileSync(jf, JSON.stringify({ points: all }), 'utf8')
console.log(`写成 JSON：${Date.now() - t} ms · ${(statSync(jf).size / 1048576).toFixed(1)} MB`)
t = Date.now()
const back = JSON.parse(require('node:fs').readFileSync(jf, 'utf8'))
console.log(`读整份 JSON：${Date.now() - t} ms · ${back.points.length} 条`)

console.log(`进程 RSS：${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`)
db.close()
rmSync(dir, { recursive: true, force: true })
