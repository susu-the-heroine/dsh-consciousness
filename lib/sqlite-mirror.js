/**
 * SQLite 镜像：和 JSON 主库并存的第二份
 * ====================================
 *
 * 2026-11-12：JSON 主库整份读写，规模一大就慢。SQLite 按行读写，实测十万条下
 * 读一条 0.01 毫秒。这一版先做"双写"：写记忆时落 JSON，也尽力落 SQLite。
 *
 * 三条硬规矩：
 *   1. 绝不因为 SQLite 出错而让写入失败——包在 try 里，出错只记日志。
 *   2. 不读不写主库：它只接 points 数据，JSON 才是权威。
 *   3. 同一份 schema 用两处（导入脚本和这里），所以建表语句放在这一个文件里。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
let SQLite = null
try { SQLite = require('node:sqlite') } catch { SQLite = null }

const _dbs = new Map()

function dbPath(sea) {
  return join(homedir(), '.dsh', 'consciousness-seas', sea, 'memory.db')
}

/** 两字 + 三字切片：中文两字词（腰疼）在 trigram 里搜不到 */
export function gramsOf(s) {
  const t = String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2))
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return [...out].join(' ')
}

function open(sea) {
  if (!SQLite) return null
  const cached = _dbs.get(sea)
  if (cached) return cached
  const p = dbPath(sea)
  try { mkdirSync(join(p, '..'), { recursive: true }) } catch {}
  const db = new SQLite.DatabaseSync(p)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY, title TEXT, alias TEXT, text TEXT,
      kind TEXT, imp REAL, arousal REAL, polarity REAL,
      born INTEGER, strength REAL, layer TEXT, era TEXT,
      category TEXT, entities TEXT, open_flag INTEGER, rule_flag INTEGER,
      dead INTEGER, merged_into INTEGER, raw TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (src INTEGER, dst INTEGER, sim REAL);
  `)
  // FTS 单独建，语法与普通表不同，失败就退化成没有索引（不让它拦住写入）
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS points_fts USING fts5(grams, tokenize='unicode61')")
  } catch {}
  _dbs.set(sea, db)
  return db
}

const joinArr = (v) => Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v))

/** 写一条（新增或覆盖） */
export function upsertPoint(sea, p) {
  if (process.env.DSH_SQLITE_MIRROR === '0') return { ok: false, skipped: true }
  try {
    const db = open(sea)
    if (!db) return { ok: false, err: 'node:sqlite 不可用' }
    const id = Number(p.id) || 0
    db.prepare(`INSERT INTO points
      (id,title,alias,text,kind,imp,arousal,polarity,born,strength,layer,era,category,entities,open_flag,rule_flag,dead,merged_into,raw)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, alias=excluded.alias, text=excluded.text, kind=excluded.kind,
        imp=excluded.imp, arousal=excluded.arousal, polarity=excluded.polarity, born=excluded.born,
        strength=excluded.strength, layer=excluded.layer, era=excluded.era, category=excluded.category,
        entities=excluded.entities, open_flag=excluded.open_flag, rule_flag=excluded.rule_flag,
        dead=excluded.dead, merged_into=excluded.merged_into, raw=excluded.raw`)
      .run(id, String(p.title || ''), String(p.alias || ''), String(p.text || ''),
        String(p.kind || ''), Number(p.imp) || 0, Number(p.arousal) || 0, Number(p.polarity) || 0,
        Number(p.born) || 0, Number(p.strength) || 0, String(p.layer || ''), String(p.era || ''),
        joinArr(p.category), joinArr(p.entities),
        p.open === true ? 1 : 0, p.rule === true ? 1 : 0,
        p.dead === true ? 1 : 0, Number(p.mergedInto) || 0,
        JSON.stringify(p))
    try {
      db.prepare('DELETE FROM points_fts WHERE rowid = ?').run(id)
      db.prepare('INSERT INTO points_fts (rowid, grams) VALUES (?,?)')
        .run(id, gramsOf(String(p.title || '') + String(p.alias || '') + String(p.text || '')))
    } catch {}
    return { ok: true }
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) }
  }
}

/** 一整批覆盖（重建用） */
export function replaceAll(sea, points, edges) {
  try {
    const db = open(sea)
    if (!db) return { ok: false, err: 'node:sqlite 不可用' }
    db.exec('BEGIN')
    db.exec('DELETE FROM points')
    db.exec('DELETE FROM edges')
    try { db.exec('DELETE FROM points_fts') } catch {}
    for (const p of points || []) upsertPoint(sea, p)
    const insE = db.prepare('INSERT INTO edges (src,dst,sim) VALUES (?,?,?)')
    for (const e of edges || []) insE.run(Number(e.from || e.src) || 0, Number(e.to || e.dst) || 0, Number(e.sim) || 0)
    db.exec('COMMIT')
    return { ok: true, n: (points || []).length }
  } catch (e) {
    try { _dbs.get(sea) && _dbs.get(sea).exec('ROLLBACK') } catch {}
    return { ok: false, err: String((e && e.message) || e) }
  }
}


/** 按编号取一批（给"先出候选、只读这几行"用） */
export function pointsByIds(sea, ids) {
  const out = []
  if (!ids || !ids.length) return out
  try {
    const db = open(sea)
    if (!db) return out
    // 分批查：SQLite 一条语句里参数太多会被限制
    const seen = new Set()
    const list = [...new Set(ids.map(Number).filter((x) => x > 0))]
    const stmt = db.prepare('SELECT raw FROM points WHERE id = ?')
    for (const id of list) {
      if (seen.has(id)) continue
      seen.add(id)
      const row = stmt.get(id)
      if (!row || !row.raw) continue
      try { out.push(JSON.parse(row.raw)) } catch {}
    }
  } catch {}
  return out
}

/** 按编号取一行的轻量信息（不解析整份 JSON） */
export function rowsByIds(sea, ids) {
  const out = []
  if (!ids || !ids.length) return out
  try {
    const db = open(sea)
    if (!db) return out
    const stmt = db.prepare('SELECT id,title,alias,text,kind,imp,arousal,polarity,born,strength,layer,era,category,entities,open_flag,rule_flag,dead FROM points WHERE id = ?')
    for (const id of [...new Set(ids.map(Number))]) {
      if (!(id > 0)) continue
      const r = stmt.get(id)
      if (r) out.push(r)
    }
  } catch {}
  return out
}

export function closeAll() {
  for (const [, db] of _dbs) { try { db.close() } catch {} }
  _dbs.clear()
}
