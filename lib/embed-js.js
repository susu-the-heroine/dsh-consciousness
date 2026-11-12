/**
 * 向量 · 纯 JS 版
 * ==============
 *
 * 不依赖模型、不联网、不装 Python。用字符 n-gram 的签哈希（signed hashing）做 512 维向量。
 *
 * 跟 bge-small-zh 的差别要说清：
 *   bge 懂"意思"——"撑不住了"和"不想说话"它知道接近。
 *   这套只懂"长得像"——同字、同词、同短语才近。
 *   所以它是"字面层的加强版"，不是语义层的等价物。
 *
 * 好处：零依赖、可复现、毫秒级；没装东西的人也能有向量这一层。
 * 用法：buildVectors(sea) 写 vectors.json（跟原来同一个格式：{id: [512 个浮点]}）
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DIM = 512

function hash32(s) {
  const h = createHash('sha1').update(s).digest()
  return h.readUInt32BE(0)
}

/** 切特征：中文按 2-3 字滑窗，英文数字按词，再叠一层整句 trigram 提升区分度 */
export function features(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const out = []
  // 中文滑窗
  const han = s.replace(/[^\u4e00-\u9fff]+/g, ' ')
  for (const seg of han.split(' ')) {
    if (!seg) continue
    const chars = [...seg]
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= chars.length; i++) out.push(chars.slice(i, i + n).join(''))
    }
  }
  // 英文与数字词
  for (const w of s.match(/[a-z0-9]{2,}/g) || []) out.push('w:' + w)
  return out
}

/** 一条文本 → 512 维单位向量 */
export function embed(text) {
  const v = new Float64Array(DIM)
  const fs = features(text)
  const tf = new Map()
  for (const f of fs) tf.set(f, (tf.get(f) || 0) + 1)
  for (const [f, n] of tf) {
    const h = hash32(f)
    const idx = h % DIM
    const sign = (h >>> 31) & 1 ? -1 : 1     // 签哈希：同一特征稳定同号，减少碰撞抵消
    v[idx] += sign * (1 + Math.log(n))       // 次线性词频
  }
  // L2 归一
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  const out = new Array(DIM)
  for (let i = 0; i < DIM; i++) out[i] = Math.round((v[i] / norm) * 1e6) / 1e6
  return out
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function vectorsPath(sea) {
  return join(homedir(), '.dsh', 'consciousness-seas', sea, 'vectors.json')
}

export function readVectors(sea) {
  const f = vectorsPath(sea)
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

/** 给一个海的每条记忆算向量，返回 {id: vec}。不落盘，调用方决定写不写。 */
export function buildVectorsFor(points) {
  const out = {}
  for (const p of points || []) {
    if (p.dead) continue
    out[String(p.id)] = embed(String(p.title || '') + ' ' + String(p.text || ''))
  }
  return out
}

export function writeVectors(sea, vecs) {
  writeFileSync(vectorsPath(sea), JSON.stringify(vecs), 'utf8')
}
