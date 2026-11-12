/**
 * 向量 · 本地推理版（不依赖 Python）
 * =================================
 *
 * 模型：bge-small-zh-v1.5 的量化 ONNX（22.9 MB），引擎：onnxruntime-web 的 WASM（14.2 MB）。
 * 两者都在 assets/embed/ 里，安装包里自带——用户装完就有，不联网、不装 Python、不装 torch。
 *
 * 与模型版必须逐句对得上：同一句话，这里算的向量跟 torch 算的余弦要 ≥0.999。
 * 对不上就是分词或池化错了，宁可报错也不许悄悄给出一套偏的向量。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const EMBED_DIR = join(HERE, '..', 'assets', 'embed')
export const DIM = 512
const MAX_LEN = 512

let _vocab = null
let _session = null
let _ort = null

function loadVocab() {
  if (_vocab) return _vocab
  const f = join(EMBED_DIR, 'vocab.txt')
  if (!existsSync(f)) throw new Error('缺 vocab.txt：' + f)
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  const m = new Map()
  lines.forEach((w, i) => {
    if (w !== '' || i === 0) m.set(w, i)
  })
  _vocab = m
  return m
}

const isCJK = (c) => {
  const code = c.codePointAt(0)
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

/** BERT 的分词：中文按字切、英文按词再 WordPiece、标点单独成 token */
export function tokenize(text) {
  const vocab = loadVocab()
  const s = String(text || '').normalize('NFKC').toLowerCase()
  const basic = []
  let buf = ''
  const flush = () => {
    if (buf) { basic.push(buf); buf = '' }
  }
  for (const ch of s) {
    if (/\s/.test(ch)) { flush(); continue }
    if (isCJK(ch)) { flush(); basic.push(ch); continue }
    // 标点与符号单独成 token
    if (/[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      flush(); basic.push(ch); continue
    }
    buf += ch
  }
  flush()

  const ids = []
  for (const w of basic) {
    if (vocab.has(w)) { ids.push(vocab.get(w)); continue }
    if (isCJK(w) || [...w].length === 1) {
      const unk = vocab.get('[UNK]') ?? 100
      ids.push(vocab.get(w) ?? unk)
      continue
    }
    // WordPiece 贪心
    const chars = [...w]
    let start = 0
    let ok = true
    const pieces = []
    while (start < chars.length) {
      let end = chars.length
      let found = null
      while (start < end) {
        const sub = (start > 0 ? '##' : '') + chars.slice(start, end).join('')
        if (vocab.has(sub)) { found = sub; break }
        end--
      }
      if (!found) { ok = false; break }
      pieces.push(found)
      start = end
    }
    if (ok) for (const p of pieces) ids.push(vocab.get(p))
    else ids.push(vocab.get('[UNK]') ?? 100)
  }
  return ids
}

export function encode(text) {
  const vocab = loadVocab()
  const cls = vocab.get('[CLS]') ?? 101
  const sep = vocab.get('[SEP]') ?? 102
  let ids = [cls, ...tokenize(text)]
  if (ids.length > MAX_LEN - 1) ids = ids.slice(0, MAX_LEN - 1)
  ids.push(sep)
  const mask = new Array(ids.length).fill(1)
  const types = new Array(ids.length).fill(0)
  return { ids, mask, types }
}

export async function getSession() {
  if (_session) return _session
  // 可用 EMBED_MODEL 指定模型文件名（量 fp32 与量化差别时用）
  const modelPath = join(EMBED_DIR, process.env.EMBED_MODEL || 'model_quantized.onnx')
  if (!existsSync(modelPath)) throw new Error('缺模型文件：' + modelPath)
  if (!_ort) {
    // 优先用 Node 专用入口；拿不到就退回通用入口
    // 只用 WASM 后端的那份入口：自带通用入口会去找 jsep 那一套，多带十几兆还用不上
    const cands = [join(EMBED_DIR, 'ort.wasm.min.mjs'), join(EMBED_DIR, 'ort.min.mjs')]
    let lastErr = null
    for (const c of cands) {
      if (!existsSync(c)) continue
      try {
        _ort = await import('file:///' + c.replace(/\\/g, '/'))
        break
      } catch (e) { lastErr = e }
    }
    if (!_ort) throw new Error('加载推理引擎失败：' + (lastErr ? lastErr.message : '文件不在'))
    // WASM 文件就在同目录
    // Node 里不要去 fetch file://（会 fetch failed），直接把 wasm 读成字节喂进去。
    // 2026-11-12 踩了三次：反斜杠路径 → 缺胶水 mjs → fetch file://。
    const wasmName = join(EMBED_DIR, 'ort-wasm-simd-threaded.wasm')
    if (!existsSync(wasmName)) throw new Error('缺 wasm：' + wasmName)
    try {
      _ort.env.wasm.wasmBinary = readFileSync(wasmName)
      _ort.env.wasm.numThreads = 1
      _ort.env.wasm.proxy = false
    } catch {}
  }
  // 网页版引擎把字符串当 URL 去 fetch，file:// 会 fetch failed——所以喂字节，不喂路径
  const modelBytes = readFileSync(modelPath)
  _session = await _ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] })
  return _session
}

/** 一句话 → 512 维单位向量（CLS 池化 + L2 归一，跟模型版一致） */
export async function embedLocal(text) {
  const sess = await getSession()
  const { ids, mask, types } = encode(text)
  const ort = _ort
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from(mask.map((x) => BigInt(x))), [1, mask.length]),
    token_type_ids: new ort.Tensor('int64', BigInt64Array.from(types.map((x) => BigInt(x))), [1, types.length]),
  }
  const out = await sess.run(feeds)
  const key = Object.keys(out)[0]
  const t = out[key]
  const dims = t.dims
  const data = t.data
  // 取第一个 token（CLS）的 512 维
  const v = new Array(dims[dims.length - 1])
  for (let i = 0; i < v.length; i++) v[i] = Number(data[i])
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => Math.round((x / norm) * 1e6) / 1e6)
}

/**
 * 批量算向量：把多条文本 pad 成同一长度，一次推理。
 * 逐条跑 13 ms，批量跑能省掉大部分调度开销——2026-11-12 加，为了压三十万条。
 */
export async function embedBatch(texts) {
  const list = (texts || []).map((x) => String(x || ''))
  if (!list.length) return []
  const sess = await getSession()
  const ort = _ort
  const encs = list.map((x) => encode(x))
  const maxLen = Math.max(...encs.map((e) => e.ids.length))
  const n = encs.length
  const ids = new BigInt64Array(n * maxLen).fill(0n)
  const mask = new BigInt64Array(n * maxLen).fill(0n)
  const types = new BigInt64Array(n * maxLen).fill(0n)
  for (let r = 0; r < n; r++) {
    const e = encs[r]
    for (let i = 0; i < e.ids.length; i++) {
      ids[r * maxLen + i] = BigInt(e.ids[i])
      mask[r * maxLen + i] = 1n
      types[r * maxLen + i] = BigInt(e.types[i] || 0)
    }
  }
  const out = await sess.run({
    input_ids: new ort.Tensor('int64', ids, [n, maxLen]),
    attention_mask: new ort.Tensor('int64', mask, [n, maxLen]),
    token_type_ids: new ort.Tensor('int64', types, [n, maxLen]),
  })
  const t = out[Object.keys(out)[0]]
  const dim = t.dims[t.dims.length - 1]
  const res = []
  for (let r = 0; r < n; r++) {
    const v = new Array(dim)
    for (let i = 0; i < dim; i++) v[i] = Number(t.data[r * dim + i])
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    res.push(v.map((x) => Math.round((x / norm) * 1e6) / 1e6))
  }
  return res
}

export async function isAvailable() {
  try {
    await getSession()
    return true
  } catch {
    return false
  }
}
