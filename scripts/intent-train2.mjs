/**
 * 意图模型 v2：拿他的真话训
 * ========================
 *
 * 数据：scripts/data/intent-user-pool.json（335 条他的原话）+ intent-user-labels.json（人工标）
 *       + scripts/data/intent-set-v2.json（150 条自建，三类各半）
 * 特征：与 v1 同（字二元组 512 桶 + 关键词组 + 句形）
 * 评估：5 折交叉验证；另在 B 站评论 45 条（陌生人）上对比 v1/v2
 * 输出：lib/intent-model-v2.json（不覆盖 v1，验过再换）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIM = 768
const LABELS = ['op', 'narr', 'unknown']
const MAP = { o: 'op', n: 'narr', u: 'unknown' }

const pool = JSON.parse(readFileSync(join(HERE, 'data', 'intent-user-pool.json'), 'utf8')).cases
const raw = JSON.parse(readFileSync(join(HERE, 'data', 'intent-user-labels.json'), 'utf8').replace(/^\uFEFF/, ''))
const letters = (raw.chunks || []).join('')
if (letters.length !== raw.n) {
  throw new Error(`标了 ${letters.length} 条，文件说 ${raw.n} 条，对不上`)
}
const user = pool.slice(0, letters.length).map((c, i) => ({ q: c.q, y: MAP[letters[i]] || 'unknown', src: 'user' }))
const self = JSON.parse(readFileSync(join(HERE, 'data', 'intent-set-v2.json'), 'utf8')).cases
  .map((c) => ({ q: c.q, y: c.y, src: 'self' }))
const stranger = JSON.parse(readFileSync(join(HERE, 'data', 'intent-stranger-pool.json'), 'utf8')).cases
  .map((c) => ({ q: c.q, y: c.y }))

const clean = (q) => String(q || '').replace(/[\s，。？！、：；""''（）()《》【】\-—…,.!?;:]/g, '')
function hash32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
const OP = ['帮我', '给我', '推荐', '教我', '怎么', '如何', '哪家', '哪个', '哪里', '多少钱', '便宜', '免费', '有没有', '列个', '起个', '写个', '写一', '做个', '找', '选', '装', '设置', '导出', '压缩', '调']
const NARR = ['那天', '那次', '当时', '上次', '上回', '后来', '以前', '之前', '前天', '昨天', '上周', '刚才', '记得', '说过', '跑通', '成了', '定了', '崩了', '报错', '为什么', '怎么回事', '那么', '这版', '那版']
const QW = ['吗', '呢', '什么', '怎么', '哪', '谁', '多少', '几', '是不是', '有没有', '能不能']

function feats(q) {
  const s = clean(q)
  const idx = []
  for (let i = 0; i + 1 < s.length; i++) idx.push(hash32(s.slice(i, i + 2)) % DIM)
  if (!idx.length && s.length) idx.push(hash32(s) % DIM)
  const add = (w, base) => idx.push(base + (hash32(w) % 64))
  for (const w of OP) if (s.includes(w)) add(w, 512)
  for (const w of NARR) if (s.includes(w)) add(w, 576)
  for (const w of QW) if (s.includes(w)) add(w, 640)
  const n = [...s].length
  idx.push(704 + (n <= 2 ? 0 : n <= 6 ? 1 : n <= 12 ? 2 : 3))
  if (/[吗呢？?]$/.test(String(q || '').trim())) idx.push(708)
  if (/^(帮我|给我|推荐|教|怎么|如何|哪)/.test(s)) idx.push(709)
  if (/\d/.test(s)) idx.push(710)
  const m = new Map()
  for (const i of idx) m.set(i, (m.get(i) || 0) + 1)
  const v = new Float64Array(DIM)
  const norm = Math.sqrt(idx.length || 1)
  for (const [i, c] of m) v[i] = c / norm
  return v
}

function train(rows, epochs = 600, lr = 0.35, l2 = 1e-3) {
  const W = LABELS.map(() => new Float64Array(DIM))
  const b = new Float64Array(LABELS.length)
  const xs = rows.map((r) => feats(r.q))
  for (let ep = 0; ep < epochs; ep++) {
    const gW = LABELS.map(() => new Float64Array(DIM))
    const gb = new Float64Array(LABELS.length)
    for (let n = 0; n < rows.length; n++) {
      const x = xs[n]
      const y = LABELS.indexOf(rows[n].y)
      const z = LABELS.map((_, k) => { let s = b[k]; for (let i = 0; i < DIM; i++) if (x[i]) s += W[k][i] * x[i]; return s })
      const mx = Math.max(...z)
      const e = z.map((v) => Math.exp(v - mx))
      const sum = e.reduce((a, c) => a + c, 0)
      for (let k = 0; k < LABELS.length; k++) {
        const p = e[k] / sum
        const g = p - (k === y ? 1 : 0)
        gb[k] += g
        for (let i = 0; i < DIM; i++) if (x[i]) gW[k][i] += g * x[i]
      }
    }
    const n = rows.length
    for (let k = 0; k < LABELS.length; k++) {
      b[k] -= (lr * gb[k]) / n
      for (let i = 0; i < DIM; i++) W[k][i] -= lr * (gW[k][i] / n + l2 * W[k][i])
    }
  }
  return { W, b }
}

function predict(model, q) {
  const x = feats(q)
  const z = LABELS.map((_, k) => { let s = model.b[k]; for (let i = 0; i < DIM; i++) if (x[i]) s += model.W[k][i] * x[i]; return s })
  const mx = Math.max(...z)
  const e = z.map((v) => Math.exp(v - mx))
  const sum = e.reduce((a, c) => a + c, 0)
  const p = e.map((v) => v / sum)
  let best = 0
  for (let k = 1; k < LABELS.length; k++) if (p[k] > p[best]) best = k
  return { label: LABELS[best], conf: p[best] }
}

const all = [...user, ...self]
// 5 折
const K = 5
let ok = 0
const per = Object.fromEntries(LABELS.map((l) => [l, { n: 0, ok: 0 }]))
for (let f = 0; f < K; f++) {
  const tr = all.filter((_, i) => i % K !== f)
  const te = all.filter((_, i) => i % K === f)
  const m = train(tr)
  for (const r of te) {
    const g = predict(m, r.q).label
    per[r.y].n++
    if (g === r.y) { per[r.y].ok++; ok++ }
  }
}
const full = train(all)
writeFileSync(join(HERE, '..', 'lib', 'intent-model-v2.json'), JSON.stringify({
  v: 2, dim: DIM, labels: LABELS,
  // 2026-11-21：这里原来写死「他的 335 条」——实际标注只覆盖了 200 条（下面 slice 按标注长度切），
  // 于是模型文件里记了个假数。改成按实际用了多少条写。
  note: `v2：他的 ${user.length} 条 + 自建 ${self.length} 条，5 折 ${(ok / all.length * 100).toFixed(1)}%`,
  W: full.W.map((w) => Array.from(w, (x) => Math.round(x * 1e5) / 1e5)),
  b: Array.from(full.b, (x) => Math.round(x * 1e5) / 1e5),
}), 'utf8')

const score = (m, rows) => {
  let c = 0
  for (const r of rows) if (predict(m, r.q).label === r.y) c++
  return (c / rows.length * 100).toFixed(1)
}
const v1 = JSON.parse(readFileSync(join(HERE, '..', 'lib', 'intent-model.json'), 'utf8'))
const v1m = { W: v1.W.map((a) => Float64Array.from(a)), b: Float64Array.from(v1.b) }

console.log(`样本 ${all.length}（他 ${user.length} / 自建 ${self.length}）`)
console.log(`5 折 ${(ok / all.length * 100).toFixed(1)}%`)
for (const l of LABELS) console.log(`  ${l}: ${per[l].ok}/${per[l].n} (${(per[l].ok / per[l].n * 100).toFixed(0)}%)`)
console.log(`陌生人 45：v1 ${score(v1m, stranger)}%  v2 ${score(full, stranger)}%`)
// 2026-11-21：这一行原来跟上一行并排印，看着像同一口径的两个数——其实不是。
// 自建 150 条是 v2 训练集里的样本，v2 这个数是「考自己」，v1 那个才是「考外人」。
console.log(`自建 150（v2 训练集内，仅供回归看别退步）：v1 外人 ${score(v1m, self)}%  v2 自己 ${score(full, self)}%`)
console.log('模型 -> lib/intent-model-v2.json')
