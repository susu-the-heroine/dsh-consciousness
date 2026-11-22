/**
 * 向量粗筛（IVF，两级）
 * ====================
 *
 * 2026-11-18 第三版。第二版单级 IVF 的规模曲线：两千条 123ms、五千 384ms、
 * 一万 914ms，每条约 0.09ms——按这个外推十万条要九秒，过不了三秒的线。
 *
 * 病根：归队时每条要跟一百九十二个中心算 512 维点积。
 * 这版改成两级：先在三十二个粗中心里选一个，只在这个粗簇的八个细中心里选。
 * 每条只算四十次点积，不是一百九十二次。
 *
 * 第一版用「取前 12 维符号」分桶，实测召回零——记在这儿，别再回头试。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SEAS_DIR } from './paths.js'

const _IDX = new Map()   // sea -> { at, n, k, coarse, centroids, parent, buckets }
const DIM = 512
const COARSE = 32
const TWO_LEVEL_MIN = 20000
const FINE = 8

// 2026-11-20：注释原先写「只抽样四分之一维」，可步长是一、等于全维都算。
// 抽样是早期试过又退回去的路子，这里按实际写清楚；要改抽样就改这个步长，别只改注释。
const STRIDE = 1
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += STRIDE) s += a[i] * b[i]; return s }

const diskPath = (sea) => join(SEAS_DIR, sea, 'ann.json')

export function saveDisk(sea, box) {
  try {
    mkdirSync(join(SEAS_DIR, sea), { recursive: true })
    writeFileSync(diskPath(sea), JSON.stringify({
      v: 3,
      mode: box.two ? 'two' : 'single',
      at: Date.now(),
      n: box.n,
      k: box.k,
      coarse: box.coarse.map((c) => Array.from(c)),
      parent: box.parent,
      centroids: box.centroids.map((c) => Array.from(c)),
      buckets: box.buckets,
    }), 'utf8')
  } catch {}
}

export function loadDisk(sea, expectMode) {
  try {
    if (!existsSync(diskPath(sea))) return null
    const o = JSON.parse(readFileSync(diskPath(sea), 'utf8'))
    if (!o || o.v !== 3 || !Array.isArray(o.buckets)) return null
    if (expectMode && o.mode !== expectMode) return null
    return {
      at: Date.now(),
      n: Number(o.n) || 0,
      k: Number(o.k) || 0,
      coarse: (o.coarse || []).map((a) => Float32Array.from(a)),
      parent: o.parent || [],
      centroids: (o.centroids || []).map((a) => Float32Array.from(a)),
      buckets: o.buckets,
    }
  } catch {
    return null
  }
}

function seed(list, k) {
  const out = []
  const step = Math.max(1, Math.floor(list.length / k))
  for (let i = 0; i < k && i * step < list.length; i++) out.push(Float32Array.from(list[i * step]))
  return out
}

function refine(vectors, cents, rounds) {
  let cs = cents
  for (let it = 0; it < rounds; it++) {
    const sums = cs.map(() => new Float32Array(DIM))
    const cnt = new Array(cs.length).fill(0)
    for (const v of vectors) {
      let bi = 0
      let bv = -2
      for (let c = 0; c < cs.length; c++) {
        const s = dot(v, cs[c])
        if (s > bv) { bv = s; bi = c }
      }
      const acc = sums[bi]
      for (let d = 0; d < DIM; d++) acc[d] += v[d]
      cnt[bi]++
    }
    cs = cs.map((c, i) => {
      if (!cnt[i]) return c
      const out = new Float32Array(DIM)
      for (let d = 0; d < DIM; d++) out[d] = sums[i][d] / cnt[i]
      return out
    })
  }
  return cs
}

/** 建索引分桶用：每 8 维取 1 维，够分桶就行；查询打分仍走全维 */
const nearestS = (v, cents) => {
  let best = 0
  let bs = -Infinity
  for (let c = 0; c < cents.length; c++) {
    const c2 = cents[c]
    let s = 0
    for (let d = 0; d < v.length; d += 8) s += v[d] * c2[d]
    if (s > bs) { bs = s; best = c }
  }
  return best
}

const nearest = (v, cents) => {
  let bi = 0
  let bv = -2
  for (let c = 0; c < cents.length; c++) {
    const s = dot(v, cents[c])
    if (s > bv) { bv = s; bi = c }
  }
  return bi
}

/**
 * 分桶数：小库按平方根，大库给总量设预算——十万条不设预算要跑十秒。
 * 预算按「条数 × 桶数 × 维度」算，上限 2.9e9 次乘加（2026-11-20 按代码改准，原先写 3.2e9）。
 * 注意：桶数有个三十二的下限——条数过五十万时预算就压不住了，这条别当成硬保证。
 */
export function planK(n, cap = 192) {
  let k = Math.min(cap, Math.max(16, Math.round(Math.sqrt(Math.max(1, n)) * 1.5)))
  const BUDGET = 2.9e9
  if (n * k * 512 > BUDGET) k = Math.max(32, Math.floor(BUDGET / (n * 512)))
  return k
}

export function build(sea, vmap) {
  const cached = _IDX.get(sea)
  if (cached && cached.n === vmap.size && Date.now() - cached.at < 300000) return cached
  if (!cached) {
    // n 在这句里被引用过，但从没定义过——两级索引一开就炸（2026-11-19）
    const n = vmap.size
    const d = loadDisk(sea, (process.env.C2_ANN_TWO !== '1' || n < TWO_LEVEL_MIN) ? 'single' : 'two')
    // 条数对上不算数：抽样看桶里的 id 是否真在这个库里，防串库（2026-11-18 夜）
    let _same = false
    if (d && d.n === vmap.size) {
      _same = true
      let _checked = 0
      for (const b of d.buckets) {
        for (const id of b) { _checked++; if (!vmap.has(Number(id))) { _same = false; break } }
        if (!_same || _checked > 200) break
      }
    }
    if (d && _same) {
      d.at = Date.now()
      _IDX.set(sea, d)
      return d
    }
  }
  const ids = [...vmap.keys()]
  const n = ids.length
  if (n < 64) return { at: Date.now(), n, k: 0, coarse: [], parent: [], centroids: [], buckets: [] }

  // 小库走单级：改动不碰今天的效果（两千到两万条这一档，单级召回 98%）
  if (process.env.C2_ANN_TWO !== '1' || n < TWO_LEVEL_MIN) {
    const k = planK(n)
    const _smp = (() => { const out = []; const step = Math.max(1, Math.floor(n / Math.min(n, 512))); for (let i = 0; i < n && out.length < 512; i += step) out.push(vmap.get(ids[i])); return out })()
    const cs = refine(_smp, seed(_smp, k), 3)
    const buckets = cs.map(() => [])
    for (const id of ids) buckets[nearest(vmap.get(id), cs)].push(id)
    const box = { at: Date.now(), n, k, two: false, coarse: cs, parent: cs.map((_, i) => i), centroids: cs, buckets }
    _IDX.set(sea, box)
    saveDisk(sea, box)
    return box
  }

  // 一级：粗中心，样本上聚
  const sample = []
  const stepS = Math.max(1, Math.floor(n / Math.min(n, 512)))
  for (let i = 0; i < n && sample.length < 512; i += stepS) sample.push(vmap.get(ids[i]))
  const coarse = refine(sample, seed(sample, Math.min(COARSE, Math.max(4, Math.round(Math.sqrt(n))))), 3)

  // 先按粗中心分一次
  const coarseOf = new Map()
  for (const id of ids) coarseOf.set(id, nearest(vmap.get(id), coarse))

  // 二级：每个粗簇里再聚一组细中心（成员多于 FINE 才聚）
  const centroids = []
  const parent = []
  const members = coarse.map(() => [])
  for (const id of ids) members[coarseOf.get(id)].push(id)

  for (let c = 0; c < coarse.length; c++) {
    const mem = members[c]
    if (!mem.length) continue
    const vs = mem.map((id) => vmap.get(id))
    const kFine = Math.max(1, Math.min(FINE, Math.round(Math.sqrt(mem.length))))
    const cs = kFine > 1 ? refine(vs.slice(0, Math.min(vs.length, 256)), seed(vs, kFine), 2) : [vs[0]]
    for (const cen of cs) {
      centroids.push(cen)
      parent.push(c)
    }
  }

  // 归队：每条按「先粗后细」落进一个细簇
  const buckets = centroids.map(() => [])
  const fineByCoarse = coarse.map(() => [])
  for (let f = 0; f < centroids.length; f++) fineByCoarse[parent[f]].push(f)
  for (const id of ids) {
    const v = vmap.get(id)
    const c = coarseOf.get(id)
    const fs = fineByCoarse[c]
    const f = fs.length === 1 ? fs[0] : fs[nearest(v, fs.map((x) => centroids[x]))]
    buckets[f].push(id)
  }

  const box = { at: Date.now(), n, k: coarse.length, coarse, parent, centroids, buckets }
  _IDX.set(sea, box)
  saveDisk(sea, box)
  return box
}

/** 查询候选：先挑粗簇，再在里面的细簇里挑 */
export function probe(sea, q, vmap) {
  const idx = build(sea, vmap)
  if (!idx.k) return new Set(vmap.keys())
  const ratio = Math.max(0.04, Math.min(0.9, Number(process.env.C2_ANN_PROBE) || 0.2))
  const nCoarse = Math.max(6, Math.round(idx.k * ratio))
  const coarseRank = idx.coarse.map((c, i) => [dot(q, c), i]).sort((a, b) => b[0] - a[0]).slice(0, nCoarse)
  const out = new Set()
  for (const [, ci] of coarseRank) {
    const fines = []
    for (let f = 0; f < idx.centroids.length; f++) if (idx.parent[f] === ci) fines.push(f)
    if (!fines.length) continue
    const take = Math.max(2, Math.round(fines.length * 0.8))
    const rank = fines.map((f) => [dot(q, idx.centroids[f]), f]).sort((a, b) => b[0] - a[0]).slice(0, take)
    for (const [, f] of rank) for (const id of idx.buckets[f]) out.add(id)
  }
  return out
}

/** 增量：新向量先归粗、再归细，只追加，不重聚 */
export function addIncremental(sea, vmap, ids) {
  const idx = _IDX.get(sea)
  if (!idx || !idx.k) return false
  const have = new Set()
  for (const b of idx.buckets) for (const id of b) have.add(id)
  const fresh = (ids || []).filter((id) => !have.has(id) && vmap.has(id))
  if (!fresh.length) return true
  for (const id of fresh) {
    const v = vmap.get(id)
    const c = nearest(v, idx.coarse)
    const fines = []
    for (let f = 0; f < idx.centroids.length; f++) if (idx.parent[f] === c) fines.push(f)
    const f = fines.length ? fines[nearest(v, fines.map((x) => idx.centroids[x]))] : 0
    idx.buckets[f].push(id)
  }
  idx.n = vmap.size
  saveDisk(sea, idx)
  return true
}

export function drop(sea) { _IDX.delete(sea) }

export function stats(sea) {
  const x = _IDX.get(sea)
  if (!x) return { built: false }
  let maxB = 0
  for (const b of x.buckets) maxB = Math.max(maxB, b.length)
  return { built: true, n: x.n, k: x.k, fine: x.centroids.length, maxBucket: maxB }
}

/** 只用落盘的索引挑候选：不碰向量本体，给「按需读」用 */
export function probeIdx(idx, q) {
  if (!idx || !idx.k) return null
  const ratio = Math.max(0.04, Math.min(0.9, Number(process.env.C2_ANN_PROBE) || 0.2))
  const nCoarse = Math.max(6, Math.round(idx.k * ratio))
  const coarseRank = idx.coarse.map((c, i) => [dot(q, c), i]).sort((a, b) => b[0] - a[0]).slice(0, nCoarse)
  const out = new Set()
  for (const [, ci] of coarseRank) {
    const fines = []
    for (let f = 0; f < idx.centroids.length; f++) if (idx.parent[f] === ci) fines.push(f)
    if (!fines.length) continue
    const take = Math.max(2, Math.round(fines.length * 0.8))
    const rank = fines.map((f) => [dot(q, idx.centroids[f]), f]).sort((a, b) => b[0] - a[0]).slice(0, take)
    for (const [, f] of rank) for (const id of idx.buckets[f]) out.add(id)
  }
  return out
}