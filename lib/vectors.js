/**
 * 向量
 * ====
 *
 * 本地 bge-small-zh，512 维。由 embed_server.py 提供，端口 8931。
 *
 * 两条原则：
 *   · 服务不在就降级——只用字面检索，不报错、不卡住
 *   · 降级要留痕——不能悄悄退回字面，得让人知道这一轮没向量
 *
 * 风险文档：「向量服务进程异常崩溃无重启机制」→ 这里是降级而不是崩。
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { withLock } from './statefile.js'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { EMBED_URL, SEAS_DIR } from './paths.js'
import * as PRIO from './priority.js'
import { audit } from './log.js'
import { gramsOf } from './text.js'
import * as VX from './vecidx.js'

/** 向量缓存：sea -> { at, map: Map(id -> Float32Array) } */
const _VEC = new Map()

/** 读一个识海的全部向量。60 秒缓存 */

/** 一条记忆用来算向量的那段文本。改这段等于改口径，指纹会变，旧向量自动算陈旧 */
export function embedTextOf(p) {
  // 2026-11-12：把别名拼进来。别名是「别人会怎么问」，比标题更像查询，
  // 实测头名从 44% 提到 49%（五十七条评测集，同一批记忆）。
  // 2026-11-20：算法收进 vecidx.textOf——之前这里和指纹那边各抄了一份，容易漂。
  return VX.textOf(p)
}

/** 文本指纹：用来判断「向量是不是还在描述当前这段文本」 */
export function shortTextOf(p) {
  // 短文本：标题 + 别名。短问句跟短标题更可比——实测十四道"目标没进候选"的，
  // 换成这一路之后十道能进前十（2026-11-12）。
  return [String((p && p.title) || ''), String((p && p.alias) || '')].filter(Boolean).join('。').slice(0, 120)
}

export function textHash(s) {
  return createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16)
}

/**
 * 句向量 sidecar：句级召回用（文档按句切分，取最像那句）
 *
 * 为什么要落盘：2026-11-27 试过在查询期算，200 条查询每条重算两万句向量，
 * 一小时没跑完。所以只在同步向量时算一次，写 sent.json，检索只读。
 *
 * 格式：{ "<id>": ["<int8 base64>", ...] }，每句 512 字节，取余弦前先除 127。
 */
let _EMBED_LOCAL_P = null

export function sentVecPath(sea) {
  return join(SEAS_DIR, sea, 'sent.json')
}

export function loadSentVecs(sea) {
  const p = sentVecPath(sea)
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const out = new Map()
    for (const [k, arr] of Object.entries(raw || {})) {
      if (!Array.isArray(arr) || !arr.length) continue
      const vs = []
      for (const b64 of arr) {
        const buf = Buffer.from(String(b64), 'base64')
        const q = new Int8Array(buf.buffer, buf.byteOffset, buf.length)
        const f = new Float32Array(q.length)
        for (let i = 0; i < q.length; i++) f[i] = q[i] / 127
        vs.push(f)
      }
      if (vs.length) out.set(Number(k), vs)
    }
    return out.size ? out : null
  } catch {
    return null
  }
}

export function sentencesOf(p) {
  const s = String((p && p.text) || '')
  return s
    .split(/[。！？!?；;\n]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
    .slice(0, Number(process.env.SENT_MAXN || 6))
}


/**
 * 向量层体检。
 *
 * 光看「向量数 == 记忆数」不算健康——文本改过、向量没重算，数量照样相等。
 * 所以按指纹比：存的 h 和当前文本算出来的 h 不一样，就是 stale。
 */
export function vectorStats(sea, data) {
  const pts = ((data && data.points) || []).filter((x) => !x.dead && !x.archived)
  let raw = {}
  try { raw = JSON.parse(readFileSync(join(SEAS_DIR, sea, 'vectors.json'), 'utf8')) } catch { raw = {} }
  let missing = 0
  let stale = 0
  let ok = 0
  for (const p of pts) {
    const cur = raw[String(p.id)]
    if (!cur || !Array.isArray(cur.v) || !cur.v.length) { missing++; continue }
    const h = VX.fpOf(p)
    if (cur.h && cur.h !== h) { stale++; continue }
    ok++
  }
  const health = embedHealth()
  const total = pts.length
  const coverage = total ? Number((ok / total).toFixed(4)) : 0
  let status = 'healthy'
  if (health.down) status = 'unhealthy'
  else if (missing > 0 || stale > 0) status = 'degraded'
  return {
    sea,
    memory_count: total,
    vector_count: Object.keys(raw).length,
    ready_count: ok,
    missing_vector_count: missing,
    stale_vector_count: stale,
    coverage,
    status,
    retrieval_mode: health.down ? 'lexical_only' : 'hybrid',
    last_success_at: health.lastOkAt || null,
    embed_down: !!health.down,
  }
}

/**
 * 把「还没向量化的记忆」补上向量。
 *
 * 之前向量是手动跑脚本算的，结果就是：新写的记忆永远是语义盲区——
 * 字面查不到它，向量也没它。这条补上「写入即向量化」。
 *
 * limit 控制一次最多补几条，防止启动时卡住。
 * 返回补了几条。
 */
/**
 * 给一条记忆单独算向量并写进去（写完立刻调）。
 * 为什么要有这个：新条目没向量时，只有字面完全对上才找得到，
 * 换个说法就查不到刚写的东西——2026-11-12 端到端测试踩到。
 */
export async function ensureVectorFor(sea, point) {
  try {
    if (!point || point.dead || point.archived) return false
    const text = embedTextOf(point)
    if (!text.trim()) return false
    const v = await embedQuery(text)
    // 算不出来就排队，别把这条丢了。重启后接着补——2026-11-18 加
    if (!v || !v.length) { try { VX.queueAdd(sea, [point.id]) } catch {} ; return false }
    const vp = join(SEAS_DIR, sea, 'vectors.json')
    let raw = {}
    try { raw = JSON.parse(readFileSync(vp, 'utf8')) } catch { raw = {} }
    raw[String(point.id)] = { fp: Number(point.born) || 0, h: VX.fpOf(point), at: Date.now(), m: 'onnx-local', v: Array.from(v) }
    const tmp = vp + '.tmp'
    writeFileSync(tmp, JSON.stringify(raw), 'utf8')
    renameSync(tmp, vp)
    try { _VEC.delete(sea) } catch {}
    try {
      VX.record(sea, point.id, VX.fpOf(point))
      // 二进制已经启用（迁移过）就同步追加，别让两条路各说各话
      if (VX.binBytes(sea) > 0) VX.appendVectors(sea, [{ id: point.id, h: VX.fpOf(point), v }])
      VX.queueDrop(sea, [point.id])
    } catch {}
    return true
  } catch { return false }
}

// 2026-11-19 夜（P61）：向量索引是「读一份 → 追加 → 写回去」，两个进程同时来会互相盖。
// 用一把全局锁把它串起来：宁可慢一拍，不许把新算的向量写丢。
export async function syncVectors(sea, data, limit) {
  const _n = await withLock(join(homedir(), '.dsh', 'vectors.lock'), () => _syncVectors(sea, data, limit), { waitMs: 5000 })
  // 向量已有缓存时 _syncVectors 会提前返回，句向量侧车得在这儿单独建一次
  try { await syncSentSidecar(sea, data) } catch {}
  return _n
}

async function _syncVectors(sea, data, limit) {
  try {
    const max = Math.max(1, Number(limit) || 1)
    // 2026-11-28：大库退回词袋引擎。
    // 换 bge 之后，五万条库的向量同步跑不完（实测两次：一次打到表头就没数据，
    // 一次到 40000/50000 断掉，已耗 11 分钟，然后进程「正常退出」）。
    // 三千条 60 秒、一万条 3 分钟都能忍，五万条撑不住。
    // 取舍：大库宁可分数低一点（旧引擎五万条 63.5%，能跑），也不能让「算不出向量」变成不可用。
    try {
      const _n = ((data && data.points) || []).filter((p) => p && !p.dead && !p.archived).length
      const _cap = Number(process.env.VEC_BGE_MAX || 100000)
      if (_n >= _cap) process.env.EMBED_ENGINE = 'fastvec'
      else if (String(process.env.EMBED_ENGINE || '') === 'fastvec' && !process.env.VEC_ENGINE_FORCED) process.env.EMBED_ENGINE = ''
    } catch {}
    const vp = join(SEAS_DIR, sea, 'vectors.json')
    let raw = {}
    try { raw = JSON.parse(readFileSync(vp, 'utf8')) } catch { raw = {} }
    // 排队的最先补（刚写的最急），其余按 id 从新到旧——老条目别永远排最后
    const _idxNow = (() => { try { return VX.readIdx(sea) } catch { return { ids: {} } } })()
    const _q = (() => { try { return VX.queueRead(sea) } catch { return [] } })()
    const _all = ((data && data.points) || []).filter((p) => p && !p.dead && !p.archived)
    const _byId = new Map(_all.map((p) => [Number(p.id), p]))
    const _ordered = []
    for (const id of _q) { const p = _byId.get(Number(id)); if (p && !_ordered.includes(p)) _ordered.push(p) }
    const _rest = _all.filter((p) => !_ordered.includes(p)).sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))
    const missing = []
    for (const p of _ordered.concat(_rest)) {
      const key = String(p.id)
      const cur = raw[key]
      // 2026-11-20：这里原来用 textHash 算指纹去比，可存的时候（本文件 115/200 行、体检那处）
      // 存的是 fpOf——两套指纹永远对不上，于是每次同步都判「陈旧」，永远只重算最新的那几条，
      // 老条目永远补不到向量。统一用 fpOf。
      const h = VX.fpOf(p)
      // 缺：没有向量
      // 陈旧：有向量，但文本改过（指纹对不上）；老向量没指纹，也算陈旧，补一次把指纹写上
      // 账本也对一遍：账本里没有/对不上，就算旧向量文件里有，也算缺——
      // 换模型时账本会整本作废，这里就靠它触发重建
      const idxH = VX.hOf(_idxNow.ids[key])
      const need = !cur || !Array.isArray(cur.v) || !cur.v.length || cur.h !== h
        || idxH === undefined || String(idxH) !== String(h)
      if (!need) continue
      missing.push(p)
      if (missing.length >= max) break
    }
    if (!missing.length) return 0

    // 批量算：本地模型一次推一批，省掉逐条调度（2026-11-18）
    // 一条条跑一万条库要十六分钟，批量后目标三百毫秒一条以内
    let done = 0
    const jobs = []
    for (const p of missing) {
      const t = embedTextOf(p)
      if (t.trim()) jobs.push({ p, t })
    }
    const B = Math.max(1, Math.min(32, Number(process.env.C2_EMBED_BATCH) || 16))
    let batcher = null
    try {
      const m = await import('file:///' + new URL('./embed-onnx.js', import.meta.url).pathname.replace(/^\//, '') + '?v=' + Date.now())
      if (m && typeof m.embedBatch === 'function') batcher = m.embedBatch
    } catch { batcher = null }
    for (let i = 0; i < jobs.length; i += B) {
      const chunk = jobs.slice(i, i + B)
      let vecs = null
      if (batcher) {
        try { vecs = await PRIO.low(() => batcher(chunk.map((j) => j.t))) } catch { vecs = null }
      }
      if (!vecs || !vecs.length) {
        // 批量不可用就退回逐条，慢但不丢
        vecs = []
        for (const j of chunk) vecs.push(await embedQuery(j.t))
      }
      let got = 0
      for (let k = 0; k < chunk.length; k++) {
        const v = vecs[k]
        if (!v || !v.length) continue
        const p = chunk[k].p
        raw[String(p.id)] = {
          fp: Number(p.born) || 0,
          h: VX.fpOf(p),                // 这段文本的指纹：文本一改，这个对不上，就是陈旧
          at: Date.now(),
          v: Array.from(v),
        }
        done++
        got++
      }
      if (!got) break                   // 这一批一条都没成，服务大概不在，下次再来
    }
    if (done) {
      const tmp = vp + '.tmp'
      try {
        writeFileSync(tmp, JSON.stringify(raw), 'utf8')
        renameSync(tmp, vp)
      } catch (e) {
        try { audit('vector-write-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
        return 0
      }
      // 让缓存失效，下一次检索就能用上新向量
      try { _VEC.delete(sea) } catch {}
      try { audit('vector-sync', { sea, added: done }) } catch {}
      try {
        VX.recordMany(sea, missing.filter((p) => raw[String(p.id)] && Array.isArray(raw[String(p.id)].v) && raw[String(p.id)].v.length)
          .map((p) => ({ id: p.id, h: raw[String(p.id)].h })))
        VX.queueDrop(sea, missing.map((p) => p.id))
        if (VX.binBytes(sea) > 0) {
          VX.appendVectors(sea, missing
            .filter((p) => raw[String(p.id)] && Array.isArray(raw[String(p.id)].v) && raw[String(p.id)].v.length)
            .map((p) => ({ id: p.id, h: raw[String(p.id)].h, v: raw[String(p.id)].v })))
        }
      } catch {}
    }
    return done
  } catch (e) {
    try { audit('vector-sync-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return 0
  }
}

/** 清缓存：测试和迁移要能强制重读 */

// 句向量侧车（索引期一次，检索只读）。只在文档库上建：平均少于 400 字的不建。
export async function syncSentSidecar(sea, data) {
  if (String(process.env.SENT_IDX || '1') === '0') return 0
  try {
    const pts = ((data && data.points) || []).filter((p) => p && !p.dead && !p.archived)
    if (!pts.length) return 0
    let avg = 0
    for (const p of pts) avg += String(p.text || '').length
    avg = avg / pts.length
    if (avg < Number(process.env.SENT_RERANK_MINLEN || 400)) return 0
    const sp = join(SEAS_DIR, sea, 'sent.json')
    let raw = {}
    try { raw = JSON.parse(readFileSync(sp, 'utf8')) || {} } catch { raw = {} }
    const m = await import('file:///' + new URL('./embed-onnx.js', import.meta.url).pathname.replace(/^\//, ''))
    const emb = m.embedLocal
    let n = 0
    for (const p of pts) {
      const k = String(p.id)
      if (Array.isArray(raw[k]) && raw[k].length) continue
      const ss = sentencesOf(p)
      if (!ss.length) continue
      const arr = []
      for (const sx of ss) {
        let v = null
        try { v = await emb(sx) } catch { v = null }
        if (!v) continue
        let norm = 0
        for (let i2 = 0; i2 < v.length; i2++) norm += v[i2] * v[i2]
        norm = Math.sqrt(norm) || 1
        const q = new Int8Array(v.length)
        for (let i2 = 0; i2 < v.length; i2++) q[i2] = Math.max(-127, Math.min(127, Math.round((v[i2] / norm) * 127)))
        arr.push(Buffer.from(q.buffer).toString('base64'))
      }
      if (!arr.length) continue
      raw[k] = arr
      n++
    }
    if (n) {
      const tmp = sp + '.tmp'
      writeFileSync(tmp, JSON.stringify(raw), 'utf8')
      renameSync(tmp, sp)
      try { audit('sent-sidecar', { sea, docs: n }) } catch {}
    }
    return n
  } catch {
    return 0
  }
}
export function clearVectorCache(sea) {
  try { _VEC.delete(sea) } catch {}
  try { _VEC_S.delete(sea) } catch {}
}

export function loadVectors(sea) {
  const _t0 = Date.now()
  const cached = _VEC.get(sea)
  const _hit = !!(cached && Date.now() - cached.at < 60000)
  if (cached && Date.now() - cached.at < 60000) return cached.map
  const p = join(SEAS_DIR, sea, 'vectors.json')
  let map = new Map()
  try {
    // 一、有二进制就从二进制读：不解析数字，快
    if (VX.binBytes(sea) > 0) map = VX.loadAllVectors(sea)
    // 二、还没有二进制但老库有 JSON：就地迁移一次，写成二进制再读
    if (!map.size && existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8'))
      const entries = []
      for (const [id, obj] of Object.entries(raw || {})) {
        if (obj && Array.isArray(obj.v) && obj.v.length === VX.MODEL_DIM) {
          entries.push({ id: Number(id), h: VX.fpOf({ id }), v: obj.v })
        }
      }
      if (entries.length) {
        // 迁移时按 id 回填指纹：找不到原文就留空指纹，下一次补向量会重算
        const byId = new Map()
        for (const [id, obj] of Object.entries(raw || {})) byId.set(Number(id), obj)
        for (const e of entries) {
          const o = byId.get(e.id)
          e.h = (o && o.h) ? String(o.h) : ''
        }
        VX.appendVectors(sea, entries)
        map = VX.loadAllVectors(sea)
      }
      // 迁移没成（老库缺维度数据）：退回 JSON 原样读，至少能用
      if (!map.size) {
        for (const [id, obj] of Object.entries(raw || {})) {
          if (obj && Array.isArray(obj.v) && obj.v.length) map.set(Number(id), Float32Array.from(obj.v))
        }
      }
    }
  } catch {}
  _VEC.set(sea, { at: Date.now(), map })
  // 2026-11-27：同上，向量缓存也没淘汰。五万条一份约 100 MB，多开几个识海只涨不落。
  // 只留最近 4 个识海。
  try {
    if (_VEC.size > 4) {
      let oldK = null
      let oldAt = Infinity
      for (const [k, v] of _VEC) {
        if (k === sea) continue
        const at = Number(v && v.at) || 0
        if (at < oldAt) { oldAt = at; oldK = k }
      }
      if (oldK !== null) _VEC.delete(oldK)
    }
  } catch {}
  try { noteVectorLatency(Date.now() - _t0) } catch {}
  return map
}

let _VEC_S = new Map()
export function loadShortVectors(sea) {
  // 短文本那一套：标题+别名。跟主向量同一次读，但单独缓存——
  // 2026-11-12 第一版在循环里重读文件，193 条读 193 次，查询从 3 秒变 92 秒。这次只读一次。
  const cached = _VEC_S.get(sea)
  if (cached && Date.now() - cached.at < 60000) return cached.map
  const p = join(SEAS_DIR, sea, 'vectors.json')
  const map = new Map()
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf8'))
      for (const [id, obj] of Object.entries(raw)) {
        if (obj && Array.isArray(obj.sv) && obj.sv.length) map.set(Number(id), Float32Array.from(obj.sv))
      }
    }
  } catch {}
  _VEC_S.set(sea, { at: Date.now(), map })
  return map
}

let _embedDownLogged = 0
/* 连续失败计数：语义层挂了要有人知道，不能悄悄退回字面 */
let _embedFails = 0
let _embedOKAt = 0

/** 语义层现在好不好使。给别处判断用，也给检索输出用。 */
export function embedHealth() {
  const fresh = _embedOKAt && Date.now() - _embedOKAt < 10 * 60 * 1000
  return {
    down: _embedFails >= 2 && !fresh,
    fails: _embedFails,
    lastOkAt: _embedOKAt,
  }
}

/** 把一句话算成向量。服务不在返回 null，不抛 */
// 2026-11-12：本地推理优先，进程内算，不依赖 Python / HTTP。
// 本地不可用（模型文件缺、wasm 起不来）再退回 HTTP 服务，都没有就返回空，检索少这一层。
let _localEmbed = null
let _localTried = false
async function localEmbed(text) {
  if (!_localTried) {
    _localTried = true
    try {
      const m = await import('file:///' + new URL('./embed-onnx.js', import.meta.url).pathname.replace(/^\//, '') + '?v=' + Date.now())
      _localEmbed = m
    } catch { _localEmbed = null }
  }
  if (!_localEmbed) return null
  try { return await _localEmbed.embedLocal(text) } catch { return null }
}

/** 前台查询：插到补库前面（2026-11-18） */
const _QEMO = new Map()   // 同一问句十分钟内不重复算（2026-11-18 夜）
export function embedQuery(text) {
  const _k = String(text || '')
  const _h = _QEMO.get(_k)
  if (_h && Date.now() - _h.at < 600000 && _h.v && _h.v.length) return Promise.resolve(_h.v)
  const _save = (v) => {
    try {
      if (v && v.length) {
        _QEMO.set(_k, { at: Date.now(), v })
        if (_QEMO.size > 128) _QEMO.delete(_QEMO.keys().next().value)
      }
    } catch {}
    return v
  }
  return import('./qbatch.js')
    .then((QB) => QB.embedMerged(text))
    .then((v) => _save((v && v.length ? v : PRIO.high(() => _embedOne(text)))))
    .then((v) => Promise.resolve(v).then(_save))
    .catch(() => Promise.resolve(PRIO.high(() => _embedOne(text))).then(_save))
}

async function _embedOne(text) {
  const local = await localEmbed(text)
  if (local && local.length) return local
  try {
    const r = await fetch(EMBED_URL + '/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 400) }),
      // 冷启动那次要加载模型，1500ms 不够；平时只要 20~45ms
      // 超时一次就等于这一轮没有语义层，所以放宽到 4 秒
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return null
    const j = await r.json()
    if (!j || !Array.isArray(j.v) || !j.v.length) {
      _embedFails++
      return null
    }
    _embedFails = 0
    _embedOKAt = Date.now()
    return Float32Array.from(j.v)
  } catch (e) {
    // 降级要留痕，不能悄悄退回字面
    _embedFails++
    if (!_embedDownLogged || Date.now() - _embedDownLogged > 60000) {
      _embedDownLogged = Date.now()
      try { audit('embed-down', { err: String(e && e.message).slice(0, 80) }) } catch {}
    }
    return null
  }
}

/** 余弦相似度。长度不一致返回 0（降级，不抛） */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/* 检索索引：每条记忆的分词 + 全局 IDF，算一次缓存住。
 * 记忆变了（新增/删除）才重算。
 * 不缓存的话 1000 条要 321ms，缓存后 20ms 以内。 */
const _INDEX = new Map()   // sea -> { n, at, grams, df, N, idf }

/** 建索引。一万条以上只存 bigram，省一半内存 */
export function getIndex(sea, data) {
  const n = data.points.length
  const cached = _INDEX.get(sea)
  if (cached && cached.n === n && Date.now() - cached.at < 30000) {
    return cached
  }
  // 一万条以上只存 bigram（不存 3-gram 和单字），省一半内存
  // 代价：长查询精度略降，但一万条本来就不是 high 档该干的事
  const bigOnly = data.points.length > 5000
  const grams = new Map()
  const df = new Map()
  const entMap = new Map()   // 实体 -> [id]
  for (const p of data.points) {
    if (p.dead) continue
    // 别名并进标题那一路：别名是他以后会用的大白话问法，
    // 强度该跟标题同级——不并进去，那条记忆就只能被"原话"问到。
    // 2026-11-11 深夜。
    const _ali = String(p.alias || '').trim()
    const t = gramsOf(String(p.title || '') + (_ali ? ' ' + _ali : ''), { single: false, bigOnly })
    const b = gramsOf(String(p.text || ''), { single: false, bigOnly })
    grams.set(p.id, { t, b })
    // 不建临时 Set：直接两遍扫，省一份数组（一万条时省几十兆）
    for (const w of t) df.set(w, (df.get(w) || 0) + 1)
    for (const w of b) {
      if (t.has(w)) continue   // t 里已经有了，不重复计数
      df.set(w, (df.get(w) || 0) + 1)
    }
    for (const e of (p.entities || [])) {
      if (!entMap.has(e)) entMap.set(e, [])
      entMap.get(e).push(p.id)
    }
  }
  // 倒排表：gram -> 命中的 id。字面打分只扫相关条，不再全库比（2026-11-18 夜）
  const post = new Map()
  for (const [id, g] of grams) {
    for (const w of g.t) { const a = post.get(w); if (a) a.push(id); else post.set(w, [id]) }
    for (const w of g.b) { const a = post.get(w); if (a) a.push(id); else post.set(w, [id]) }
  }
  const N = n
  const idf = (w) => Math.log(1 + N / (df.get(w) || 1))
  const idx = { n, at: Date.now(), grams, df, N, idf, entMap, post }
  _INDEX.set(sea, idx)
  // 2026-11-27：这个缓存原来没有淘汰——每开一个识海就永久留一份整库 gram 索引。
  // 五万条那份是几百万个小对象（每篇 t/b 两组 Set）。多开几个识海，内存只涨不落。
  // 他报过「重启后卡、内存 21 GB」，这是其中一个可疑源。
  // 只留最近 4 个识海，淘汰最久没用的那个。
  try {
    if (_INDEX.size > 4) {
      let oldK = null
      let oldAt = Infinity
      for (const [k, v] of _INDEX) {
        if (k === sea) continue
        const at = Number(v && v.at) || 0
        if (at < oldAt) { oldAt = at; oldK = k }
      }
      if (oldK !== null) _INDEX.delete(oldK)
    }
  } catch {}
  return idx
}

/**
 * 图游走：从命中的几条出发，沿边往外扩。
 * 这是 HippoRAG 的思路（Personalized PageRank），衰减系数 0.85。
 * 好处：问「那次吵架」，能带出「那天之前他在憋什么」——字面完全不像，但有边连着。
 */
export function expandByGraph(seedIds, data, steps = 3, damp = 0.85) {
  const adj = new Map()
  for (const e of (data.edges || [])) {
    // 2026-11-21：库里存的是 from/to，这儿按 a/b 取——两头都空，邻居表永远为空，
    // 「沿边往外扩」一次都没扩成过。两种写法都认，权重也认 sim。
    const a = e.a !== undefined ? Number(e.a) : Number(e.from)
    const b = e.b !== undefined ? Number(e.b) : Number(e.to)
    const w = Number(e.w ?? e.sim ?? 0.3) || 0.3
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push({ to: b, w })
    adj.get(b).push({ to: a, w })
  }
  const score = new Map()
  const queue = []
  for (const id of seedIds) {
    score.set(id, 1)
    queue.push({ id, w: 1, d: 0 })
  }
  while (queue.length) {
    const cur = queue.shift()
    if (cur.d >= steps) continue
    for (const nb of (adj.get(cur.id) || [])) {
      const nw = cur.w * damp * nb.w
      if (nw < 0.02) continue
      if (nw > (score.get(nb.to) || 0)) {
        score.set(nb.to, nw)
        queue.push({ id: nb.to, w: nw, d: cur.d + 1 })
      }
    }
  }
  return score
}


/**
 * 模式补全（CA3）
 * ==============
 *
 * 海马体 CA3 那套：给一半线索，它把整段模式补出来。
 * 不是「从一个点往外扩散」，是「几个点同时亮的时候，找它们共同指向的那个东西」。
 *
 * 具体做法：
 *   拿命中的前几条当种子，数每个节点被几个种子连着。
 *   被 2 个以上种子连着的，就是「共同指向」——它多半是这段记忆的中心，
 *   但因为字面不像、向量也不近，单看任何一条都轮不到它。
 *
 * 和 expandByGraph 的区别：
 *   expandByGraph 是「走」——能到这儿的都算，越远越轻。
 *   completePattern 是「凑」——必须被多条同时指到，一条连的不算。
 *
 * 为什么要这个：问「那次吵架」，字面能翻出「他骂我」和「后来和好」，
 * 但真正那段「我们为什么吵」是两条的共同邻居，两条都不像它，它却最该出现。
 */
export function completePattern(seedIds, data, minSeeds = 2) {
  const seeds = new Set((seedIds || []).map(Number))
  if (seeds.size < 2) return new Map()

  const adj = new Map()
  for (const e of (data.edges || [])) {
    // 2026-11-21：跟上面那支同一个毛病——边按 a/b 取，库里存的是 from/to，邻居表永远空。
    // 「被两条同时指到的那个中心」一次也没被凑出来过。两种写法都认。
    const a = e.a !== undefined ? Number(e.a) : Number(e.from)
    const b = e.b !== undefined ? Number(e.b) : Number(e.to)
    const w = Number(e.w ?? e.sim ?? 0.3) || 0.3
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push({ to: b, w })
    adj.get(b).push({ to: a, w })
  }

  // 每个节点被哪些种子连着
  const touch = new Map()   // id -> { n: 几个种子, sum: 权重和 }
  for (const sid of seeds) {
    const seen = new Set()
    for (const nb of (adj.get(sid) || [])) {
      if (seeds.has(nb.to)) continue          // 种子之间互连不算
      if (seen.has(nb.to)) continue           // 同一条边不重复算
      seen.add(nb.to)
      const cur = touch.get(nb.to) || { n: 0, sum: 0 }
      cur.n += 1
      cur.sum += nb.w
      touch.set(nb.to, cur)
    }
  }

  const out = new Map()
  for (const [id, v] of touch) {
    if (v.n < minSeeds) continue
    // 被越多条同时指到越可信；平均权重也参与
    out.set(id, (v.n / seeds.size) * (v.sum / v.n))
  }
  return out
}


/* ==========================================================
 * 2026-11-18 加的对外面：缺口、批量补齐、健康度
 * 用户反馈：老条目一次只补两条，两百多条要上百次搜索才追平。
 * ========================================================== */

/** 还差多少条：读小账本，不解析整块向量 */
export function vectorGap(sea, data) {
  try {
    const r = VX.reconcile(sea, data)
    return { total: r.total, have: r.fresh, need: r.missing + r.stale }
  } catch {
    return { total: 0, have: 0, need: 0 }
  }
}

/**
 * 一次补到底（有预算）。队列优先，补完返回还剩多少。
 * 时间到就停，剩下的下一轮继续，不把请求拖长。
 */
export async function backfillVectors(sea, data, opt = {}) {
  const batch = Math.max(1, Number(opt.batch) || 20)
  const budget = Math.max(1000, Number(opt.budgetMs) || 20000)
  const t0 = Date.now()
  let filled = 0
  let rounds = 0
  for (;;) {
    if (Date.now() - t0 > budget) break
    const before = vectorGap(sea, data).need
    const q = (() => { try { return VX.queueRead(sea).length } catch { return 0 } })()
    if (!before && !q) break
    const n = await syncVectors(sea, data, Math.min(batch, Math.max(1, before + q)))
    rounds++
    if (!n) break
    filled += n
    if (typeof opt.onProgress === 'function') {
      try { opt.onProgress({ filled, remaining: vectorGap(sea, data).need }) } catch {}
    }
  }
  const left = vectorGap(sea, data).need
  try { audit('vector-backfill', { sea, filled, left, rounds, ms: Date.now() - t0 }) } catch {}
  return { filled, remaining: left, rounds, ms: Date.now() - t0 }
}

/** 健康度：覆盖率 / 陈旧率 / 队列 / p95 —— 摆到台面上，不让人猜 */
export function vectorHealth(sea, data) {
  const r = VX.reconcile(sea, data)
  const h = embedHealth()
  return {
    sea,
    model: r.model,
    dim: r.dim,
    total: r.total,
    fresh: r.fresh,
    stale: r.stale,
    missing: r.missing,
    queued: r.queued,
    coverage: Number((r.coverage * 100).toFixed(2)),
    stale_rate: Number((r.stale_rate * 100).toFixed(2)),
    p95_ms: Number(VX.latencyP95().toFixed(1)),
    bin_bytes: VX.binBytes(sea),
    bytes: VX.bytesOf(sea),
    rebuilt_from_other_model: r.rebuilt,
    embed_down: !!h.down,
    retrieval_mode: h.down ? 'lexical_only' : 'hybrid',
  }
}

export function noteVectorLatency(ms) { try { VX.noteLatency(ms) } catch {} }
