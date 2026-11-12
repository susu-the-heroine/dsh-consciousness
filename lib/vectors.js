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
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { EMBED_URL, SEAS_DIR } from './paths.js'
import { audit } from './log.js'
import { gramsOf } from './text.js'

/** 向量缓存：sea -> { at, map: Map(id -> Float32Array) } */
const _VEC = new Map()

/** 读一个识海的全部向量。60 秒缓存 */

/** 一条记忆用来算向量的那段文本。改这段等于改口径，指纹会变，旧向量自动算陈旧 */
export function embedTextOf(p) {
  // 2026-11-12：把别名拼进来。别名是「别人会怎么问」，比标题更像查询，
  // 实测头名从 44% 提到 49%（五十七条评测集，同一批记忆）。
  const alias = String((p && p.alias) || '').trim()
  const base = String((p && p.title) || '') + '。' + String((p && p.text) || '')
  return (alias ? alias + '。' + base : base).slice(0, 400)
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
    const h = textHash(embedTextOf(p))
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
    if (!v || !v.length) return false
    const vp = join(SEAS_DIR, sea, 'vectors.json')
    let raw = {}
    try { raw = JSON.parse(readFileSync(vp, 'utf8')) } catch { raw = {} }
    raw[String(point.id)] = { fp: Number(point.born) || 0, h: textHash(text), at: Date.now(), m: 'onnx-local', v: Array.from(v) }
    const tmp = vp + '.tmp'
    writeFileSync(tmp, JSON.stringify(raw), 'utf8')
    renameSync(tmp, vp)
    try { _VEC.delete(sea) } catch {}
    return true
  } catch { return false }
}

export async function syncVectors(sea, data, limit) {
  try {
    const max = Math.max(1, Number(limit) || 1)
    const vp = join(SEAS_DIR, sea, 'vectors.json')
    let raw = {}
    try { raw = JSON.parse(readFileSync(vp, 'utf8')) } catch { raw = {} }
    const missing = []
    for (const p of (data && data.points) || []) {
      if (p.dead || p.archived) continue
      const key = String(p.id)
      const cur = raw[key]
      const h = textHash(embedTextOf(p))
      // 缺：没有向量
      // 陈旧：有向量，但文本改过（指纹对不上）；老向量没指纹，也算陈旧，补一次把指纹写上
      const need = !cur || !Array.isArray(cur.v) || !cur.v.length || cur.h !== h
      if (!need) continue
      missing.push(p)
      if (missing.length >= max) break
    }
    if (!missing.length) return 0

    let done = 0
    for (const p of missing) {
      const text = embedTextOf(p)
      if (!text.trim()) continue
      const v = await embedQuery(text)
      if (!v || !v.length) break          // 服务不在就停，下次再来
      raw[String(p.id)] = {
        fp: Number(p.born) || 0,
        h: textHash(text),                // 这段文本的指纹：文本一改，这个对不上，就是陈旧
        at: Date.now(),
        v: Array.from(v),
      }
      done++
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
    }
    return done
  } catch (e) {
    try { audit('vector-sync-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return 0
  }
}

export function loadVectors(sea) {
  const cached = _VEC.get(sea)
  if (cached && Date.now() - cached.at < 60000) return cached.map
  const p = join(SEAS_DIR, sea, 'vectors.json')
  const map = new Map()
  try {
    if (!existsSync(p)) return map
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    for (const [id, obj] of Object.entries(raw)) {
      if (obj && Array.isArray(obj.v) && obj.v.length) {
        map.set(Number(id), Float32Array.from(obj.v))
      }
    }
  } catch {}
  _VEC.set(sea, { at: Date.now(), map })
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

export async function embedQuery(text) {
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
  const N = n
  const idf = (w) => Math.log(1 + N / (df.get(w) || 1))
  const idx = { n, at: Date.now(), grams, df, N, idf, entMap }
  _INDEX.set(sea, idx)
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
    const a = e.a, b = e.b, w = Number(e.w) || 0.3
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
    const a = e.a, b = e.b, w = Number(e.w) || 0.3
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
