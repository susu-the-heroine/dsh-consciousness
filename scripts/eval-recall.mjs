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

// 2026-11-21：没有向量的条目在这儿等于隐形——上面排法拿空向量去比，分是零，
// 永远进不了前十，却不报错。实测主库二百二十六条里五条没向量，这个数得说出来，
// 不然「命中@10 九成」会被误读成「全都排得动」。
// 2026-11-21 自纠：头一版把「已归档」也算成「没向量」，报出五条永远排不上——
// 那五条本来就是归档的，不该参与排名，这么写是冤枉。拆开算：
const archived = pts.filter((p) => p.archived || p.validUntil).map((p) => p.id)
const noVec = pts.filter((p) => !p.archived && !p.validUntil && !vecs.get(p.id)).map((p) => p.id)
if (archived.length) console.log(`已归档/已失效 ${archived.length} 条，本来就不参与排名`)
if (noVec.length) {
  const wantNoVec = cases.filter((c) => noVec.includes(Number(c.want))).map((c) => c.want)
  console.log(`在册却没有向量的 ${noVec.length} 条（永远排不上）：${noVec.slice(0, 10).map((i) => '#' + i).join(' ')}`)
  if (wantNoVec.length) console.log(`其中 ${wantNoVec.length} 条正是标准答案：${wantNoVec.map((i) => '#' + i).join(' ')}——这几道必挂，不是排序问题`)
}

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
