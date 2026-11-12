/**
 * 检索评测：五十条自己写的问句
 * ============================
 *
 * 只测"向量层"的排序，不测整套检索——整套要起宿主，这里够用来看改动方向。
 * 指标：命中@1、命中@3、命中@10。
 *
 * 跑法：node scripts/eval-recall.mjs [sea]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] || 'main'
const set = JSON.parse(readFileSync(join(HERE, 'data', 'recall-set.json'), 'utf8').replace(/^\uFEFF/, ''))
const cases = set.cases

const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)
const vecs = V.loadVectors(sea)

console.log(`海 ${sea} · 记忆 ${pts.length} 条 · 向量 ${vecs.size} 条 · 问句 ${cases.length} 条`)

const t0 = Date.now()
const qvecs = {}
for (const c of cases) qvecs[c.q] = await E.embedLocal(c.q)

const rank = (qv) => pts
  .map((p) => ({ id: p.id, s: V.cosine(qv, vecs.get(p.id) || new Float32Array(0)) }))
  .sort((a, b) => b.s - a.s)

let h1 = 0
let h3 = 0
let h10 = 0
const misses = []
for (const c of cases) {
  const r = rank(qvecs[c.q]).map((x) => x.id)
  const pos = r.indexOf(c.want)
  if (pos === 0) h1++
  if (pos >= 0 && pos < 3) h3++
  if (pos >= 0 && pos < 10) h10++
  if (pos !== 0) misses.push({ q: c.q, want: c.want, at: pos < 0 ? '没进前50' : pos + 1, top: r.slice(0, 3) })
}
const n = cases.length
console.log('')
console.log(`命中@1  ${h1}/${n}  (${((h1 / n) * 100).toFixed(0)}%)`)
console.log(`命中@3  ${h3}/${n}  (${((h3 / n) * 100).toFixed(0)}%)`)
console.log(`命中@10 ${h10}/${n}  (${((h10 / n) * 100).toFixed(0)}%)`)
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)
console.log('')
console.log('没进头名的：')
for (const m of misses) console.log(`  ${m.q}  想要 #${m.want}，排第 ${m.at}，前三 ${m.top.map((x) => '#' + x).join(',')}`)
