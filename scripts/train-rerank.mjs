/**
 * 重排器：离线训练 + 交叉验证
 * ==========================
 *   node scripts/train-rerank.mjs [--folds 5]
 *
 * 目的：现在几路分数是人手拍的权重。这里用真库题学一组权重，
 * 看头名能不能压过手搓那版。学不动就不接进运行时——先看数。
 *
 * 特征都是现成的：字面重合、语义相似、标题包含、实体命中、新鲜度、长度比。
 * 模型只有七个权重，能回滚、能解释。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')
const { readSea } = await import(LIB + '/store.js')
const V = await import(LIB + '/vectors.js')

const cases = JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || []
const data = readSea('main')
const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))

const grams = (s) => {
  const out = new Set()
  const t = String(s || '')
  for (const seg of (t.match(/[\u4e00-\u9fa5]+/g) || [])) {
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2))
  }
  for (const w of (t.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w)
  return out
}

const feats = (q, p, cos) => {
  const A = grams(q)
  const B = grams([p.title, p.text, p.alias].filter(Boolean).join(' '))
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  const overlap = A.size ? hit / A.size : 0
  const titleHas = String(p.title || '').includes(String(q || '').trim()) ? 1 : 0
  const aliasHas = p.alias && String(p.alias).includes(String(q || '').trim()) ? 1 : 0
  // 2026-11-21：库里存的字段是复数（entities），单数只是老数据的兜底。
  // 这里原来只读单数——真库里的实体命中特征会永远是零，学出来的权重看着正常、其实少了一路。
  const _ent = Array.isArray(p.entities) ? p.entities : (Array.isArray(p.entity) ? p.entity : [])
  // 2026-11-21：试过改成「任何一个实体被提到就算命中」，量完反而更差（学习排序 98.4→98.1、
  // 五折 98.4→97.8）。这一版照回原样：只比第一个实体。原理上更对的写法，数据不认。
  const ent = _ent.join(' ')
  const entHit = ent && String(q).includes(ent.split(/\s+/)[0] || '__') ? 1 : 0
  const days = Math.min(3650, (Date.now() - (Number(p.born) || 0)) / 86400000)
  const fresh = 1 / (1 + days / 30)
  const lenRatio = Math.min(1, String(q || '').length / Math.max(8, String(p.title || '').length))
  return [overlap, cos, titleHas, aliasHas, entHit, fresh, lenRatio]
}

const rows = []
for (const c of cases) {
  if (!c || !c.q || !c.want) continue
  const want = Number(c.want)
  if (!byId.has(want)) continue
  const r = await searchTool.execute({ query: c.q, limit: 12, review: false })
  const ids = []
  for (const line of String(r.log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) ids.push(Number(m[1]))
  }
  if (!ids.length) continue
  const qv = await V.embedQuery(String(c.q))
  const vmap = V.loadVectors('main')
  for (const id of ids) {
    const p = byId.get(id)
    if (!p) continue
    const vec = vmap.get(id)
    const cos = qv && vec ? V.cosine(qv, vec) : 0
    rows.push({ q: c.q, id, y: id === want ? 1 : 0, f: feats(c.q, p, cos), pos: ids.indexOf(id) })
  }
}

/* 反馈样本：judge 判错的那批当硬负样本，该哪条当正样本 */
try {
  const F = await import(LIB + '/feedback.js')
  const fb = F.readFeedback(2000).filter((r) => Number(r.expect) > 0)
  const seenQ = new Set()
  for (const r of fb) {
    if (seenQ.has(r.q) || seenQ.size >= 200) continue
    seenQ.add(r.q)
    if (!byId.has(Number(r.expect))) continue
    const rr = await searchTool.execute({ query: r.q, limit: 12, review: false })
    const ids = []
    for (const line of String(rr.log || '').split('\n')) {
      const m = line.match(/^· #(\d+)/)
      if (m) ids.push(Number(m[1]))
    }
    if (!ids.length) continue
    const qv2 = await V.embedQuery(String(r.q))
    const vm2 = V.loadVectors('main')
    for (const id of ids) {
      const p = byId.get(id)
      if (!p) continue
      const vec = vm2.get(id)
      const cos2 = qv2 && vec ? V.cosine(qv2, vec) : 0
      rows.push({ q: r.q, id, y: id === Number(r.expect) ? 1 : 0, f: feats(r.q, p, cos2), pos: ids.indexOf(id), from: 'feedback' })
    }
  }
  if (seenQ.size) console.log('反馈样本并入：' + seenQ.size + ' 轮')
} catch {}

const N = rows.length
const F = rows[0] ? rows[0].f.length : 0
const byQ = new Map()
for (const r of rows) {
  if (!byQ.has(r.q)) byQ.set(r.q, [])
  byQ.get(r.q).push(r)
}
const qs = [...byQ.keys()]

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const dot = (w, f) => { let s = 0; for (let i = 0; i < f.length; i++) s += w[i] * f[i]; return s }

function train(list, epochs = 400, lr = 0.15, l2 = 0.01) {
  const w = new Array(F).fill(0)
  const b = [0]
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(F).fill(0)
    let gb = 0
    for (const r of list) {
      const p = sigmoid(dot(w, r.f) + b[0])
      const g = p - r.y
      for (let i = 0; i < F; i++) gw[i] += g * r.f[i]
      gb += g
    }
    for (let i = 0; i < F; i++) w[i] -= lr * (gw[i] / list.length + l2 * w[i])
    b[0] -= lr * (gb / list.length)
  }
  return { w, b: b[0] }
}

function top1(byQ, scorer) {
  let hit = 0
  let n = 0
  for (const [q, list] of byQ) {
    if (!list.some((r) => r.y === 1)) continue
    n++
    const best = list.slice().sort((a, b2) => scorer(b2) - scorer(a))[0]
    if (best && best.y === 1) hit++
  }
  return { hit, n, rate: n ? hit / n : 0 }
}

const baseScorer = (r) => -r.pos          // 现有排序：位置越靠前越好
const cvK = Math.max(2, Math.min(5, qs.length))
let cvHit = 0
let cvN = 0
for (let k = 0; k < cvK; k++) {
  const testQs = new Set(qs.filter((_, i) => i % cvK === k))
  const trainRows = rows.filter((r) => !testQs.has(r.q))
  const testMap = new Map([...byQ].filter(([q]) => testQs.has(q)))
  const m = train(trainRows)
  const res = top1(testMap, (r) => dot(m.w, r.f) + m.b)
  cvHit += res.hit
  cvN += res.n
}

const full = train(rows)
const base = top1(byQ, baseScorer)
const model = top1(byQ, (r) => dot(full.w, r.f) + full.b)

console.log(`样本 ${N} 条查询轮 ${qs.length} 轮`)
console.log(`现有排序 头名 ${base.hit}/${base.n} = ${(base.rate * 100).toFixed(1)}%`)
console.log(`学习排序 头名 ${model.hit}/${model.n} = ${(model.rate * 100).toFixed(1)}%`)
console.log(`${cvK} 折交叉验证 头名 ${cvHit}/${cvN} = ${(cvN ? (cvHit / cvN * 100).toFixed(1) : '0')}%`)

const outDir = join(HERE, 'data', 'rerank')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const stampFile = join(outDir, 'model-' + stamp + '.json')
const modelJson = {
  version: 1,
  trainedAt: new Date().toISOString(),
  features: ['overlap', 'cosine', 'titleHas', 'aliasHas', 'entityHit', 'freshness', 'lenRatio'],
  w: full.w,
  b: full.b,
  metrics: {
    base_top1: Number((base.rate * 100).toFixed(2)),
    model_top1: Number((model.rate * 100).toFixed(2)),
    cv_top1: Number((cvN ? (cvHit / cvN * 100) : 0).toFixed(2)),
    n: base.n,
  },
}
writeFileSync(stampFile, JSON.stringify(modelJson, null, 2), 'utf8')
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(modelJson, null, 2), 'utf8')
console.log('写入 ' + stampFile)
