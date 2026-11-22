/**
 * 意图小模型：离线训练（零依赖，纯 JS）
 * ==================================
 *
 * 做法：字符二元组 → 512 桶哈希 → 归一化 → 三分类 softmax 回归。
 * 权重存成 JSON（~15KB），推理在 lib/intent2.js 里手写，不引任何依赖。
 *
 *   node scripts/intent-train.mjs
 *
 * 输出：lib/intent-model.json
 * 评估：5 折交叉验证（按样本序号切，固定可复现），打印准确率与各类召回。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SET = join(HERE, 'data', 'intent-set-v2.json')
const OUT = join(HERE, '..', 'lib', 'intent-model.json')

const DIM = 768 // 512 桶字二元组 + 192 桶关键词组 + 句形特征，再留余量
const LABELS = ['op', 'narr', 'unknown']
const data = JSON.parse(readFileSync(SET, 'utf8')).cases

// 关键词组：给模型几条「人话线索」，不然 150 条样本学不出泛化
const OP_WORDS = ['帮我', '给我', '推荐', '教我', '怎么', '如何', '哪家', '哪个', '哪里', '多少钱', '便宜', '免费', '有没有', '列个', '起个', '写个', '写一', '做个', '找', '选', '装', '设置', '导出', '压缩', '调']
const NARR_WORDS = ['那天', '那次', '当时', '上次', '上回', '后来', '以前', '之前', '前天', '昨天', '上周', '刚才', '记得', '说过', '跑通', '成了', '定了', '崩了', '报错', '为什么', '怎么回事', '那么', '这版', '那版']
const Q_WORDS = ['吗', '呢', '什么', '怎么', '哪', '谁', '多少', '几', '是不是', '有没有', '能不能']

// 同一个哈希要在训练和推理里一致：FNV-1a
export function hash32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function clean(q) {
  return String(q || '').replace(/[\s，。？！、：；""''（）()《》【】\-—…,.!?;:]/g, '')
}

function feats(q) {
  const s = clean(q)
  const idx = []
  for (let i = 0; i + 1 < s.length; i++) idx.push(hash32(s.slice(i, i + 2)) % DIM)
  if (!idx.length && s.length) idx.push(hash32(s) % DIM)
  // 关键词组与句形：给 150 条的小样本一点先验
  const add = (w, base, span) => idx.push(base + (hash32(w) % span))
  for (const w of OP_WORDS) if (s.includes(w)) add(w, 512, 64)
  for (const w of NARR_WORDS) if (s.includes(w)) add(w, 576, 64)
  for (const w of Q_WORDS) if (s.includes(w)) add(w, 640, 64)
  const n = [...s].length
  idx.push(704 + (n <= 2 ? 0 : n <= 6 ? 1 : n <= 12 ? 2 : 3))
  if (/[吗呢？?]$/.test(String(q || '').trim())) idx.push(708)
  if (/^(帮我|给我|推荐|教|怎么|如何|哪)/.test(s)) idx.push(709)
  if (/\d/.test(s)) idx.push(710)
  // 计数归一化
  const m = new Map()
  for (const i of idx) m.set(i, (m.get(i) || 0) + 1)
  const v = new Float64Array(DIM)
  const norm = Math.sqrt(idx.length || 1)
  for (const [i, c] of m) v[i] = c / norm
  return v
}

function train(rows, epochs = 500, lr = 0.35, l2 = 1e-3) {
  const W = LABELS.map(() => new Float64Array(DIM))
  const b = new Float64Array(LABELS.length)
  const xs = rows.map((r) => feats(r.q))
  for (let ep = 0; ep < epochs; ep++) {
    const gW = LABELS.map(() => new Float64Array(DIM))
    const gb = new Float64Array(LABELS.length)
    for (let n = 0; n < rows.length; n++) {
      const x = xs[n]
      const y = LABELS.indexOf(rows[n].y)
      const z = LABELS.map((_, k) => {
        let s = b[k]
        for (let i = 0; i < DIM; i++) if (x[i]) s += W[k][i] * x[i]
        return s
      })
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
      for (let i = 0; i < DIM; i++) {
        const g = gW[k][i] / n + l2 * W[k][i]
        W[k][i] -= lr * g
      }
    }
  }
  return { W, b }
}

function predict(model, q) {
  const x = feats(q)
  const z = LABELS.map((_, k) => {
    let s = model.b[k]
    for (let i = 0; i < DIM; i++) if (x[i]) s += model.W[k][i] * x[i]
    return s
  })
  const mx = Math.max(...z)
  const e = z.map((v) => Math.exp(v - mx))
  const sum = e.reduce((a, c) => a + c, 0)
  const p = e.map((v) => v / sum)
  let best = 0
  for (let k = 1; k < LABELS.length; k++) if (p[k] > p[best]) best = k
  return { label: LABELS[best], conf: p[best], p }
}

// 5 折交叉验证
const K = 5
let correct = 0
const per = Object.fromEntries(LABELS.map((l) => [l, { n: 0, ok: 0 }]))
const conf = {}
for (let f = 0; f < K; f++) {
  const tr = data.filter((_, i) => i % K !== f)
  const te = data.filter((_, i) => i % K === f)
  const m = train(tr)
  for (const r of te) {
    const got = predict(m, r.q).label
    per[r.y].n++
    if (got === r.y) { per[r.y].ok++; correct++ }
    else {
      const key = r.y + '→' + got
      conf[key] = conf[key] || []
      if (conf[key].length < 4) conf[key].push(r.q)
    }
  }
}
const acc = correct / data.length

// 全量重训，保存
const full = train(data)
writeFileSync(OUT, JSON.stringify({
  v: 1, dim: DIM, labels: LABELS,
  note: `训练于 ${new Date().toISOString()}，5 折准确率 ${(acc * 100).toFixed(1)}%`,
  W: full.W.map((w) => Array.from(w, (x) => Math.round(x * 1e5) / 1e5)),
  b: Array.from(full.b, (x) => Math.round(x * 1e5) / 1e5),
}), 'utf8')

console.log(`样本 ${data.length}，5 折准确率 ${(acc * 100).toFixed(1)}%`)
for (const l of LABELS) console.log(`  ${l}: ${per[l].ok}/${per[l].n} (${((per[l].ok / per[l].n) * 100).toFixed(0)}%)`)
for (const [k, arr] of Object.entries(conf)) console.log(`  错：${k} 例：${arr.join(' / ')}`)
console.log('模型 -> ' + OUT)
