/**
 * 向量存储（v2）
 * ==============
 *
 * 2026-11-18 重做。原来整块 `vectors.json`：一条 512 维的数组写成 JSON 文本，
 * 两千条就要解析几十万个数——开窗口、每次检索都吃这一刀。
 *
 * 现在三件东西分开：
 *   vectors.bin       纯 Float32 小端拼起来，按偏移读，不解析
 *   vectors.idx.json  一本小账：id → {h, off, len}，外加模型名和维度
 *   vectors.queue.json 待建队列：新写的先进队，落盘，重启接着跑
 *
 * 一条原则：账本先写、数据后写会丢；数据先写、账本后写只会多一段垃圾。
 * 所以顺序永远是「先 append bin，再原子换 idx」。
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  statSync,
  createReadStream,
  openSync,
  readSync,
  closeSync,
} from 'node:fs'
import { join } from 'node:path'
import { SEAS_DIR } from './paths.js'
import { audit } from './log.js'

/** 模型身份证：换模型/换维度，旧账全部作废重建。改名就等于全体陈旧。 */
export const MODEL_ID = 'bge-small-zh-v1.5-q8'
export const MODEL_DIM = 512

const dirOf = (sea) => join(SEAS_DIR, sea)
export const binPath = (sea) => join(dirOf(sea), 'vectors.bin')
export const idxPath = (sea) => join(dirOf(sea), 'vectors.idx.json')
export const queuePath = (sea) => join(dirOf(sea), 'vectors.queue.json')
const legacyPath = (sea) => join(dirOf(sea), 'vectors.json')

/* ---------- 账本 ---------- */

const emptyIdx = () => ({ v: 2, model: MODEL_ID, dim: MODEL_DIM, at: 0, n: 0, ids: {} })

export function readIdx(sea) {
  try {
    if (!existsSync(idxPath(sea))) return emptyIdx()
    const o = JSON.parse(readFileSync(idxPath(sea), 'utf8'))
    if (!o || typeof o !== 'object' || !o.ids) return emptyIdx()
    // 模型一对不上：整本作废（不是清空文件，是当它全是陈旧，重建时覆盖）
    if (o.model !== MODEL_ID || Number(o.dim) !== MODEL_DIM) {
      return { ...emptyIdx(), staleModel: String(o.model || ''), staleDim: Number(o.dim) || 0 }
    }
    // 二进制块校验：大小或哈希对不上，说明块坏了——整本作废，重建
    if (process.env.C2_VERIFY_BLOB === '1' && o.blob && existsSync(binPath(sea))) {
      const buf = readFileSync(binPath(sea))
      const h = createHash('sha1').update(buf).digest('hex')
      if (Number(o.blob.n) !== buf.length || String(o.blob.h) !== h) {
        // 只判废、不删：删文件会让别处正在读的人瞬间读空（2026-11-18 夜）
        return { ...emptyIdx(), staleBlob: true }
      }
    }
    return o
  } catch {
    return emptyIdx()
  }
}

function writeIdx(sea, idx) {
  idx.at = Date.now()
  idx.n = Object.keys(idx.ids).length
  try {
    if (existsSync(binPath(sea))) {
      const buf = readFileSync(binPath(sea))
      idx.blob = { n: buf.length, h: createHash('sha1').update(buf).digest('hex') }
    }
  } catch {}
  const tmp = idxPath(sea) + '.tmp'
  writeFileSync(tmp, JSON.stringify(idx), 'utf8')
  renameSync(tmp, idxPath(sea))
}

/* ---------- 数据 ---------- */

/** 读一条向量；越界/文件没了都返回 null，不抛 */
export function readVec(sea, id) {
  let fd = -1
  try {
    const idx = readIdx(sea)
    const e = idx.ids[String(id)]
    if (!e) return null
    const p = binPath(sea)
    if (!existsSync(p)) return null
    const size = statSync(p).size
    if (e.off + e.len > size) return null
    const buf = Buffer.alloc(e.len)
    fd = openSync(p, 'r')
    readSync(fd, buf, 0, e.len, e.off)
    const f = new Float32Array(buf.buffer, buf.byteOffset, e.len / 4)
    return Float32Array.from(f)
  } catch {
    return null
  } finally {
    if (fd >= 0) { try { closeSync(fd) } catch {} }
  }
}

/** 全部向量：一次读整块 bin，用视图切，不解析 JSON 里的数字 */
export function loadAll(sea) {
  const map = new Map()
  try {
    const idx = readIdx(sea)
    const p = binPath(sea)
    if (!existsSync(p)) return map
    const buf = readFileSync(p)
    for (const [id, e] of Object.entries(idx.ids)) {
      if (e.off + e.len > buf.length) continue
      const f = new Float32Array(buf.buffer, buf.byteOffset + e.off, e.len / 4)
      map.set(Number(id), Float32Array.from(f))
    }
  } catch {}
  return map
}

/** 只读指定的几条——检索时候选集只有几十条，没必要把两千条全搬进内存 */
export function loadSome(sea, ids) {
  const out = new Map()
  for (const id of ids || []) {
    const v = readVec(sea, id)
    if (v) out.set(Number(id), v)
  }
  return out
}

/**
 * 批量落盘：把 [(id, fingerprint, Float32Array)] 追加进 bin，再一次性换账本。
 * 中途崩：bin 尾部多一段没人认领的字节，下次 append 会从 idx 记的最大偏移续写，
 * 这段垃圾只会浪费几 KB，不会读错。
 */
export function putMany(sea, entries) {
  if (!entries || !entries.length) return 0
  const idx = readIdx(sea)
  let end = 0
  for (const e of Object.values(idx.ids)) end = Math.max(end, e.off + e.len)
  // 2026-11-21：先把「文件比账本短」这件事处理掉，再算新条的偏移。
  // 原来顺序反了——偏移按旧尾算，真正追加却落在文件尾，新写的几条读回来是空的。
  // 实测：文件被清到 8 字节、账本还说有条在 100 字节处，写进去一条就再也读不出来。
  const p0 = binPath(sea)
  if (existsSync(p0)) {
    const real0 = statSync(p0).size
    if (real0 < end) {
      const fix0 = {}
      for (const [id0, e0] of Object.entries(idx.ids)) if (e0.off + e0.len <= real0) fix0[id0] = e0
      idx.ids = fix0
      end = real0
      // 有洞的话，老账本已经不可信了——标记，让上层重建
      idx.broken = true
    }
  }
  const parts = []
  let cursor = end
  let n = 0
  for (const it of entries) {
    if (!it || !it.id || !it.v || !it.v.length) continue
    const f = Float32Array.from(it.v)
    const buf = Buffer.from(f.buffer, 0, f.byteLength)
    parts.push(buf)
    idx.ids[String(it.id)] = { h: it.h, off: cursor, len: buf.length }
    cursor += buf.length
    n++
  }
  if (!n) return 0
  const p = binPath(sea)
  if (!existsSync(p)) writeFileSync(p, Buffer.alloc(0))
  appendFileSync(p, Buffer.concat(parts))
  writeIdx(sea, idx)
  try { writeShadow(sea, entries) } catch {}
  return n
}


/* ---------- 影子槽：换模型过渡 ---------- */
export const shadowId = () => String(process.env.C2_VEC_SHADOW || '').trim()
const shadowBin = (sea) => join(dirOf(sea), 'vectors.' + shadowId() + '.bin')
const shadowIdxPath = (sea) => join(dirOf(sea), 'vectors.' + shadowId() + '.idx.json')

function readShadowIdx(sea) {
  try {
    if (!existsSync(shadowIdxPath(sea))) return { v: 2, model: shadowId(), dim: MODEL_DIM, ids: {} }
    const o = JSON.parse(readFileSync(shadowIdxPath(sea), 'utf8'))
    if (!o || !o.ids) return { v: 2, model: shadowId(), dim: MODEL_DIM, ids: {} }
    return o
  } catch { return { v: 2, model: shadowId(), dim: MODEL_DIM, ids: {} } }
}

/** 把同一批向量往影子槽再写一份；没配影子就什么都不做 */
export function writeShadow(sea, entries) {
  const id = shadowId()
  if (!id || !entries || !entries.length) return 0
  try {
    const idx = readShadowIdx(sea)
    let end = 0
    for (const e of Object.values(idx.ids)) end = Math.max(end, e.off + e.len)
    const parts = []
    let cursor = end
    let n = 0
    for (const it of entries) {
      if (!it || !it.id || !it.v || !it.v.length) continue
      const f = Float32Array.from(it.v)
      const buf = Buffer.from(f.buffer, 0, f.byteLength)
      parts.push(buf)
      idx.ids[String(it.id)] = { h: it.h, off: cursor, len: buf.length }
      cursor += buf.length
      n++
    }
    if (!n) return 0
    if (!existsSync(shadowBin(sea))) writeFileSync(shadowBin(sea), Buffer.alloc(0))
    appendFileSync(shadowBin(sea), Buffer.concat(parts))
    idx.model = id
    idx.dim = MODEL_DIM
    idx.n = Object.keys(idx.ids).length
    idx.at = Date.now()
    writeFileSync(shadowIdxPath(sea), JSON.stringify(idx), 'utf8')
    return n
  } catch { return 0 }
}

export function shadowStats(sea) {
  const id = shadowId()
  if (!id) return { on: false }
  try {
    const idx = readShadowIdx(sea)
    return { on: true, model: id, n: Object.keys(idx.ids).length }
  } catch { return { on: true, model: id, n: 0 } }
}

/* ---------- 迁移：老 vectors.json → bin + idx ---------- */

export function migrateLegacy(sea) {
  try {
    if (existsSync(idxPath(sea)) || !existsSync(legacyPath(sea))) return { migrated: 0 }
    const raw = JSON.parse(readFileSync(legacyPath(sea), 'utf8'))
    const entries = []
    for (const [id, o] of Object.entries(raw || {})) {
      if (!o || !Array.isArray(o.v) || !o.v.length) continue
      if (o.v.length !== MODEL_DIM) continue
      entries.push({ id: Number(id), h: o.h || 0, v: o.v })
    }
    const n = putMany(sea, entries)
    try { audit('vec-migrate', { sea, n }) } catch {}
    return { migrated: n }
  } catch (e) {
    try { audit('vec-migrate-err', { sea, err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return { migrated: 0, error: true }
  }
}

/* ---------- 队列：新写的先补 ---------- */

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
  const p = queuePath(sea)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), ids: uniq }), 'utf8')
  renameSync(tmp, p)
  return uniq
}

export function queueAdd(sea, ids) {
  const cur = queueRead(sea)
  return queueWrite(sea, cur.concat(ids))
}

export function queueDrop(sea, ids) {
  const drop = new Set(ids.map(Number))
  const cur = queueRead(sea).filter((x) => !drop.has(x))
  return queueWrite(sea, cur)
}

/* ---------- 健康度 ---------- */

export function indexStats(sea, data) {
  const idx = readIdx(sea)
  const points = ((data && data.points) || []).filter((p) => p && !p.dead && !p.archived)
  let stale = 0
  let missing = 0
  for (const p of points) {
    const e = idx.ids[String(p.id)]
    if (!e) missing++
    else if (e.h !== fpOf(p)) stale++
  }
  const total = points.length
  const fresh = Math.max(0, total - missing - stale)
  return {
    model: idx.model,
    dim: idx.dim,
    total,
    fresh,
    stale,
    missing,
    coverage: total ? fresh / total : 1,
    staleRate: total ? stale / total : 0,
    queued: queueRead(sea).length,
    bytes: (() => { try { return statSync(binPath(sea)).size } catch { return 0 } })(),
    broken: !!idx.broken,
  }
}

/* 指纹算法放在这儿，只有一处，别两边各算一套 */
import { createHash } from 'node:crypto'
export function fpOf(p) {
  const alias = String((p && p.alias) || '').trim()
  const base = String((p && p.title) || '') + '。' + String((p && p.text) || '')
  const s = (alias ? alias + '。' + base : base).slice(0, 400)
  return Number('0x' + createHash('sha1').update(s).digest('hex').slice(0, 8))
}
