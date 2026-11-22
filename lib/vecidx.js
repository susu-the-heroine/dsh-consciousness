/**
 * 向量索引的账本与队列
 * ====================
 *
 * 2026-11-18 加。用户反馈：老条目一次只补两条，两百多条要上百次搜索才追平。
 * 病根不在补得慢，在「没有账」——谁有向量、谁是陈旧、谁在排队，全靠解析
 * 整块 vectors.json 才知道。两千条就是每次开窗口都全量读一遍。
 *
 * 这里只干三件事：
 *   1. 记一本小账：id → 文本指纹，外加模型名和维度
 *   2. 记一条队列：刚写进去还没算向量的，落盘、重启接着跑
 *   3. 算健康度：覆盖率、陈旧率、队列长度、检索 p95
 */
import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SEAS_DIR } from './paths.js'

export const MODEL_ID = 'bge-small-zh-v1.5-q8'
export const MODEL_DIM = 512

const idxPath = (sea) => join(SEAS_DIR, sea, 'vectors.idx.json')
const queuePath = (sea) => join(SEAS_DIR, sea, 'vectors.queue.json')

const emptyIdx = () => ({ v: 1, model: MODEL_ID, dim: MODEL_DIM, at: 0, ids: {} })

/**
 * 一条记忆用来算向量的那段文本。
 * 2026-11-20：这段原来在 vectors.js 里还抄了一份——两边的注释都写着「只此一处」，
 * 实际两份。今天刚因为两套指纹打架吃过亏，干脆收成一处：那边改成调这个。
 */
export function textOf(p) {
  const alias = String((p && p.alias) || '').trim()
  const base = String((p && p.title) || '') + '。' + String((p && p.text) || '')
  return (alias ? alias + '。' + base : base).slice(0, 400)
}

/** 一条记忆的文本指纹——只有这一处算，别两边各一套 */
export function fpOf(p) {
  return createHash('sha256').update(textOf(p)).digest('hex').slice(0, 16)
}

export function readIdx(sea) {
  try {
    if (!existsSync(idxPath(sea))) return emptyIdx()
    const o = JSON.parse(readFileSync(idxPath(sea), 'utf8'))
    if (!o || typeof o !== 'object' || !o.ids) return emptyIdx()
    if (o.model !== MODEL_ID || Number(o.dim) !== MODEL_DIM) {
      // 换模型/维度：整本作废。返回空账，让上层按「全缺」重建，
      // 旧文件不动，等重建覆盖——不静默删人东西。
      return { ...emptyIdx(), staleModel: String(o.model || ''), staleDim: Number(o.dim) || 0 }
    }
    return o
  } catch {
    return emptyIdx()
  }
}

function writeIdx(sea, idx) {
  idx.at = Date.now()
  const tmp = idxPath(sea) + '.tmp'
  writeFileSync(tmp, JSON.stringify(idx), 'utf8')
  renameSync(tmp, idxPath(sea))
}

export function record(sea, id, fp) {
  const idx = readIdx(sea)
  const cur = idx.ids[String(id)]
  idx.ids[String(id)] = { h: String(fp || ''), ...(cur && cur.off !== undefined ? { off: cur.off, len: cur.len } : {}) }
  writeIdx(sea, idx)
}

/** 一条账目里的指纹：兼容老格式（纯字符串） */
export function hOf(entry) {
  if (!entry) return undefined
  return typeof entry === 'string' ? entry : entry.h
}

export function recordMany(sea, pairs) {
  if (!pairs || !pairs.length) return 0
  const idx = readIdx(sea)
  for (const it of pairs) {
    if (!it || !it.id) continue
    const cur = idx.ids[String(it.id)]
    idx.ids[String(it.id)] = {
      h: String(it.h || ''),
      ...(it.off !== undefined ? { off: it.off, len: it.len } : (cur && cur.off !== undefined ? { off: cur.off, len: cur.len } : {})),
    }
  }
  writeIdx(sea, idx)
  return pairs.length
}

/* ---------- 队列 ---------- */

export function queueRead(sea) {
  try {
    if (!existsSync(queuePath(sea))) return []
    const o = JSON.parse(readFileSync(queuePath(sea), 'utf8'))
    return Array.isArray(o && o.ids) ? o.ids.map(Number).filter((x) => x > 0) : []
  } catch {
    return []
  }
}

function queueWrite(sea, ids) {
  const uniq = Array.from(new Set(ids.map(Number).filter((x) => x > 0)))
  const tmp = queuePath(sea) + '.tmp'
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), ids: uniq }), 'utf8')
  renameSync(tmp, queuePath(sea))
  return uniq
}

export function queueAdd(sea, ids) {
  return queueWrite(sea, queueRead(sea).concat(ids || []))
}

export function queueDrop(sea, ids) {
  const drop = new Set((ids || []).map(Number))
  return queueWrite(sea, queueRead(sea).filter((x) => !drop.has(x)))
}

/* ---------- 体检 ---------- */

export function reconcile(sea, data) {
  const idx = readIdx(sea)
  const pts = ((data && data.points) || []).filter((p) => p && !p.dead && !p.archived)
  let stale = 0
  let missing = 0
  for (const p of pts) {
    const e = idx.ids[String(p.id)]
    if (e === undefined) missing++
    else if (hOf(e) !== fpOf(p)) stale++
  }
  const total = pts.length
  const fresh = Math.max(0, total - missing - stale)
  return {
    model: idx.model,
    dim: idx.dim,
    total,
    fresh,
    stale,
    missing,
    queued: queueRead(sea).length,
    coverage: total ? fresh / total : 1,
    stale_rate: total ? stale / total : 0,
    rebuilt: !!idx.staleModel,
  }
}

/* ---------- 检索延迟（p95） ---------- */

const _lat = []
export function noteLatency(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return
  _lat.push(n)
  if (_lat.length > 200) _lat.shift()
}
export function latencyP95() {
  if (!_lat.length) return 0
  const a = [..._lat].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]
}

export function bytesOf(sea) {
  try {
    let n = 0
    for (const f of ['vectors.json', 'vectors.idx.json', 'vectors.queue.json']) {
      const p = join(SEAS_DIR, sea, f)
      if (existsSync(p)) n += statSync(p).size
    }
    return n
  } catch {
    return 0
  }
}


/* ==========================================================
 * 紧凑存储：向量写成一段 Float32 二进制
 * 为什么：两千条 512 维，JSON 文本要解析几十万个数字；
 * 二进制直接按偏移读，少一道解析。整块读也好，单条读也好。
 * ========================================================== */
import { appendFileSync, readSync, openSync, closeSync } from 'node:fs'

const binPath = (sea) => join(SEAS_DIR, sea, 'vectors.bin')

export function appendVectors(sea, entries) {
  if (!entries || !entries.length) return 0
  const idx = readIdx(sea)
  let end = 0
  for (const e of Object.values(idx.ids)) if (e && e.off !== undefined) end = Math.max(end, e.off + e.len)
  const p = binPath(sea)
  const real = existsSync(p) ? statSync(p).size : 0
  if (real < end) end = real          // 文件被清理过：从实际尾部续写
  const parts = []
  let cursor = end
  let n = 0
  for (const it of entries) {
    if (!it || !it.id || !it.v || !it.v.length) continue
    const f = Float32Array.from(it.v)
    const buf = Buffer.from(f.buffer, 0, f.byteLength)
    parts.push(buf)
    idx.ids[String(it.id)] = { h: String(it.h || ''), off: cursor, len: buf.length }
    cursor += buf.length
    n++
  }
  if (!n) return 0
  if (!existsSync(p)) writeFileSync(p, Buffer.alloc(0))
  appendFileSync(p, Buffer.concat(parts))
  writeIdx(sea, idx)
  return n
}

export function loadAllVectors(sea) {
  const map = new Map()
  try {
    const idx = readIdx(sea)
    const p = binPath(sea)
    if (!existsSync(p)) return map
    const buf = readFileSync(p)
    for (const [id, e] of Object.entries(idx.ids)) {
      if (!e || e.off === undefined) continue
      if (e.off + e.len > buf.length) continue
      const f = new Float32Array(buf.buffer, buf.byteOffset + e.off, e.len / 4)
      map.set(Number(id), Float32Array.from(f))
    }
  } catch {}
  return map
}

export function readVector(sea, id) {
  let fd = -1
  try {
    const idx = readIdx(sea)
    const e = idx.ids[String(id)]
    if (!e || e.off === undefined) return null
    const p = binPath(sea)
    if (!existsSync(p)) return null
    // 2026-11-20：先核对文件真有这么长。文件被清过、账本偏移还留着旧值时，
    // 原来会读出一整段零——长度对得上、内容全是 0，相似度恒为零，悄悄失效。
    const _size = statSync(p).size
    if (e.off + e.len > _size) return null
    const buf = Buffer.alloc(e.len)
    fd = openSync(p, 'r')
    const _got = readSync(fd, buf, 0, e.len, e.off)
    if (_got !== e.len) return null
    return Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, e.len / 4))
  } catch {
    return null
  } finally {
    if (fd >= 0) { try { closeSync(fd) } catch {} }
  }
}

export function binBytes(sea) {
  try {
    const p = binPath(sea)
    return existsSync(p) ? statSync(p).size : 0
  } catch { return 0 }
}
