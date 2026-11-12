/**
 * 实验：句子级重排能不能把对的顶上来
 * ==================================
 *
 * 现状：一条记忆压成一个向量（标题+别名+正文前 400 字），问句跟它比余弦。
 *   问题：一条记忆里常有好几个话题，压成一个向量会被平均掉，问句只撞上其中一句时分数不高。
 *
 * 这个实验：把正文按句切开，逐句算向量，问句跟每条记忆的「最像那句」比。
 *   然后量三种排序的头名/前三/前十：
 *     A 现在这套（整条向量）
 *     B 句子最大相似（max over sentences）
 *     C 两者折中（0.5 A + 0.5 B）
 *
 * 只读，不改生产。跑法：node scripts/exp-sentence-rerank.mjs [sea]
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())

const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const points = (data.points || []).filter((p) => !p.dead)
const vecs = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8').replace(/^\uFEFF/, ''))
const setPath = join(HERE, 'data', 'recall-set-v2.json')
const cases = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, '')).cases
  .filter((c) => c && c.q && c.want != null)

function sentences(text) {
  return String(text || '')
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .slice(0, 24)
}

// 1) 逐句算向量（缓存到文件，第二次跑就快）
const cacheFile = join(dir, 'sentence-vectors.json')
let sentVec = {}
if (existsSync(cacheFile)) {
  try { sentVec = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch { sentVec = {} }
}
let computed = 0
for (const p of points) {
  const key = String(p.id)
  if (Array.isArray(sentVec[key]) && sentVec[key].length) continue
  const ss = sentences(p.text)
  const vs = []
  for (const s of ss.slice(0, 8)) {
    try { vs.push(await E.embedLocal(s)) } catch {}
  }
  sentVec[key] = vs
  computed++
  if (computed % 20 === 0) console.log(`  句子向量算到 ${computed} 条…`)
}
if (computed) {
  writeFileSync(cacheFile, JSON.stringify(sentVec), 'utf8')
  console.log(`句向量算完 ${computed} 条，已缓存`)
}

// 2) 三种排序
const ids = points.map((p) => Number(p.id))
const stats = { A: { 1: 0, 3: 0, 10: 0 }, B: { 1: 0, 3: 0, 10: 0 }, C: { 1: 0, 3: 0, 10: 0 } }

for (const c of cases) {
  const want = [Number(c.want), ...(Array.isArray(c.also) ? c.also.map(Number) : [])]
  const qv = await E.embedLocal(c.q)
  const rows = []
  for (const id of ids) {
    const raw = vecs[String(id)]
    const dv = raw && (Array.isArray(raw) ? raw : raw.v)
    const docSim = dv ? V.cosine(qv, dv) : -1
    let mx = -1
    for (const sv of (sentVec[String(id)] || [])) {
      const s = V.cosine(qv, sv)
      if (s > mx) mx = s
    }
    rows.push({ id, docSim, maxSent: mx })
  }
  const rank = (key) => rows.slice().sort((a, b) => b[key] - a[key])
  const A = rank('docSim').map((r) => r.id)
  const B = rank('maxSent').map((r) => r.id)
  const C = rows.slice().sort((a, b) => (0.5 * b.docSim + 0.5 * b.maxSent) - (0.5 * a.docSim + 0.5 * a.maxSent)).map((r) => r.id)
  for (const [name, order] of [['A', A], ['B', B], ['C', C]]) {
    for (const k of [1, 3, 10]) {
      const top = order.slice(0, k)
      if (top.some((id) => want.includes(id))) stats[name][k]++
    }
  }
}

const n = cases.length
console.log('')
console.log(`题 ${n} 道`)
for (const name of ['A', 'B', 'C']) {
  const s = stats[name]
  console.log(`  ${name}: 头名 ${(s[1] / n * 100).toFixed(0)}% · 前三 ${(s[3] / n * 100).toFixed(0)}% · 前十 ${(s[10] / n * 100).toFixed(0)}%`)
}
console.log('')
console.log('A=整条向量（现状）· B=句子最大相似 · C=折中')
