/**
 * 查询合并器
 * ==========
 *
 * 2026-11-18 加。八路并发 p95 三百一十一毫秒：一条排队三十八毫秒，八条正好三百出头。
 * 闸只保证顺序，不缩短总量——真正要的是把同一小段里到的问句合成一批算。
 *
 * 做法：八毫秒窗口内到达的查询攒成一批，一次 embedBatch；
 * 同样的问句直接吃缓存，不再算。
 */
import * as PRIO from './priority.js'
import { embedBatch } from './embed-onnx.js'

const WINDOW = Math.max(2, Number(process.env.C2_QBATCH_MS) || 8)
const Q = []
let timer = null
const CACHE = new Map()
const CACHE_MAX = 300

function remember(text, v) {
  try {
    CACHE.set(text, v)
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
  } catch {}
}

async function batcher() { return embedBatch }

async function flush() {
  timer = null
  const batch = Q.splice(0, Q.length)
  if (Q.length) timer = setTimeout(flush, 0)
  if (!batch.length) return
  const texts = batch.map((b) => b.text)
  let vecs = null
  try {
    const fn = await batcher()
    if (fn) vecs = await PRIO.high(() => fn(texts))
  } catch { vecs = null }
  if (!vecs || !vecs.length) {
    for (const b of batch) b.resolve(null)
    return
  }
  for (let i = 0; i < batch.length; i++) {
    const v = vecs[i]
    if (v && v.length) {
      const f = Float32Array.from(v)
      remember(batch[i].text, f)
      batch[i].resolve(f)
    } else {
      batch[i].resolve(null)
    }
  }
}

/** 排队等这一小批；命中缓存立刻返回 */
export function embedMerged(text) {
  const t = String(text || '')
  if (!t) return Promise.resolve(null)
  const hit = CACHE.get(t)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    Q.push({ text: t, resolve })
    if (!timer) timer = setTimeout(flush, WINDOW)
  })
}

export function stats() {
  return { queued: Q.length, cached: CACHE.size }
}
