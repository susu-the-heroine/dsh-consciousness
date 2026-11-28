/**
 * 识海内核：一个底座，三个头。
 *
 * 输入一句话，一次前向出三组判断：
 *   emotion  负 / 中 / 正    （情绪极性，对应 polarity -1/0/1）
 *   gate     值不值得记       （写入闸）
 *   human    像不像人话       （人话打分器）
 *
 * 三个判别共用同一个 4 层 512 底座，17.4 MB（int8），不依赖 bge。
 *
 * 实测（微博 31797 条分层留出，int8 版）：
 *   情绪 66.0 · 写入闸 94.5 · 人话 99.0
 * 对照 bge 那套：69.1 / 89.5 / 97.2
 *
 * 只出标签和分，不生成一个字。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenize } from './tok-xiaohai.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EMBED_DIR = join(HERE, '..', 'assets', 'embed')
const MODEL = join(EMBED_DIR, 'shihai_core.onnx')

const SEQ = 64
const V = 10000
const PAD = V - 1   // 训练时 pad 被 clip 到 V-1，这里照做

let _ort = null
let _sess = null
let _sessP = null
let _native = false

async function engine() {
  if (_ort) return _ort
  try {
    const p = join(EMBED_DIR, 'native', 'onnxruntime-node', 'dist', 'index.js')
    if (existsSync(p)) {
      const m = await import('file:///' + p.replace(/\\/g, '/'))
      if (m && m.InferenceSession) {
        _ort = m
        _native = true
        return _ort
      }
    }
  } catch {}

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
  const wasmName = join(EMBED_DIR, 'ort-wasm-simd-threaded.wasm')
  if (!existsSync(wasmName)) throw new Error('缺 wasm：' + wasmName)
  try {
    _ort.env.wasm.wasmBinary = readFileSync(wasmName)
    _ort.env.wasm.numThreads = 1
    _ort.env.wasm.proxy = false
  } catch {}
  return _ort
}

// 只建一次；并发调用共用同一个 promise，不然 wasm 那边会互踩
async function session() {
  if (_sess) return _sess
  if (_sessP) return _sessP
  _sessP = (async () => {
    const ort = await engine()
    if (!existsSync(MODEL)) throw new Error('缺识海内核：' + MODEL)
    _sess = _native
      ? await ort.InferenceSession.create(MODEL, { executionProviders: ['cpu'] })
      : await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ['wasm'] })
    return _sess
  })()
  try {
    return await _sessP
  } catch (e) {
    _sessP = null
    throw e
  }
}

let _chain = Promise.resolve()
function lock(fn) {
  const p = _chain.then(fn, fn)
  _chain = p.then(() => {}, () => {})
  return p
}

function encode(text) {
  const ids = tokenize(String(text || ''), SEQ)
  const arr = new BigInt64Array(SEQ)
  for (let i = 0; i < SEQ; i++) arr[i] = BigInt(i < ids.length ? ids[i] : PAD)
  return arr
}

/**
 * 反向构词补丁 —— 这是补丁，不是模型能力。
 *
 * 模型把「今天开心死了哈哈哈」判成负面，因为它只认出「死」这个字。
 * 「开心死了 / 笑死 / 好看到爆 / 香迷糊了」这一族，字面是惨，意思是夸。
 * 训练语料里这种太少，模型学不到，所以在这儿兜。
 *
 * 只在模型判负面、且整句能匹配到正面构词时改判正面。
 * 别的什么都不动——宁可少补，不能乱改。
 */
const POS_STRONG = /(开心|高兴|快乐|爽|舒服|好笑|笑死|笑抽|好看|好听|好吃|好玩|漂亮|帅|可爱|喜欢|爱了|绝了|牛|厉害|香|馋|治愈|暖心|温柔|感动|满足|值了|赚了|真棒|太棒|牛逼)/
const BAD_LOOKING = /(死|爆|炸|哭|裂|麻|上天|疯|完|绝|顶)/
const NEGATE = /(不|没|别|讨厌|恶心|烦|难受|痛|崩|垃圾|烂|差)/

function patchEmotion(text, label) {
  const s = String(text || '')
  if (label !== 'neg') return label
  // 句子里同时有强正面词和「死/爆/哭/裂」这种字面狠词，又没有真正的否定词，改判正面
  if (POS_STRONG.test(s) && BAD_LOOKING.test(s) && !NEGATE.test(s)) return 'pos'
  return label
}

/**
 * 一次判一批。返回三组结果，顺序和输入一致。
 * @param {string[]} texts
 * @returns {Promise<{emotion:string, polarity:number, gate:number, human:number}[]>}
 */
export async function judge(texts) {
  if (!texts || !texts.length) return []
  return lock(async () => {
    const sess = await session()
    const ort = await engine()
    const n = texts.length
    const flat = new BigInt64Array(n * SEQ)
    for (let i = 0; i < n; i++) flat.set(encode(texts[i]), i * SEQ)
    const out = await sess.run({ input_ids: new ort.Tensor('int64', flat, [n, SEQ]) })
    const emo = out.emotion.data, gate = out.gate.data, hum = out.human.data
    const res = []
    for (let i = 0; i < n; i++) {
      // 情绪三类的 argmax
      let bi = 0
      for (let k = 1; k < 3; k++) if (emo[i * 3 + k] > emo[i * 3 + bi]) bi = k
      const LABEL = ['neg', 'neutral', 'pos']
      // 2026-11-28：页面上的情绪条要动，光给标签永远满格——把三类概率一起带出去
      const _e0 = emo[i * 3], _e1 = emo[i * 3 + 1], _e2 = emo[i * 3 + 2]
      const _mx = Math.max(_e0, _e1, _e2)
      const _x0 = Math.exp(_e0 - _mx), _x1 = Math.exp(_e1 - _mx), _x2 = Math.exp(_e2 - _mx)
      const _sum = _x0 + _x1 + _x2 || 1
      const probs = [_x0 / _sum, _x1 / _sum, _x2 / _sum]
      const raw = LABEL[bi]
      const emoLabel = patchEmotion(texts[i], raw)
      // 写入闸 / 人话是二分类：类 1 的 logit 减类 0，差越大越偏类 1
      res.push({
        emotion: emoLabel,
        polarity: emoLabel === 'pos' ? 1 : (emoLabel === 'neg' ? -1 : 0),
        probs,
        gate: Number((gate[i * 2 + 1] - gate[i * 2]).toFixed(3)),
        human: Number((hum[i * 2 + 1] - hum[i * 2]).toFixed(3)),
        patched: emoLabel !== raw,
      })
    }
    return res
  })
}

/** 单条便捷入口 */
export async function judgeOne(text) {
  const r = await judge([text])
  return r[0]
}

export async function isAvailable() {
  try {
    if (!existsSync(MODEL)) return false
    await session()
    return true
  } catch {
    return false
  }
}

export function backendName() {
  return _native ? 'native' : 'wasm'
}
