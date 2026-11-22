/**
 * 意图小模型 · 推理端
 * ==================
 *
 * 权重在 intent-model.json（离线训的，~20KB JSON，零依赖）。
 * 用法：classify2(q) -> { label, conf }；只在高置信时回 op/narr，否则回 unknown。
 * 和规则版（intent.js）的关系：**不互相兜底**。模型没把握就直接 unknown，
 * 理由在下面第 73 行那段实测里（规则兜底会把模型从六成六拉到三成七）。
 * 2026-11-20 按实现改准：头注释原先写的「退回规则」和实现对不上。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
let MODEL = null
try {
  MODEL = JSON.parse(readFileSync(join(HERE, 'intent-model.json'), 'utf8'))
} catch {
  MODEL = null
}

const clean = (q) => String(q || '').replace(/[\s，。？！、：；""''（）()《》【】\-—…,.!?;:]/g, '')

function hash32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function classify2(q) {
  if (!MODEL || !Array.isArray(MODEL.W)) return { label: 'unknown', conf: 0 }
  const DIM = MODEL.dim
  const W = MODEL.W
  const b = MODEL.b
  const LABELS = MODEL.labels
  const s = clean(q)
  const idx = []
  for (let i = 0; i + 1 < s.length; i++) idx.push(hash32(s.slice(i, i + 2)) % DIM)
  if (!idx.length && s.length) idx.push(hash32(s) % DIM)
  // 关键词组特征必须在推理端和训练端完全一致，否则权重对不上号
  const OP = ['帮我', '给我', '推荐', '教我', '怎么', '如何', '哪家', '哪个', '哪里', '多少钱', '便宜', '免费', '有没有', '列个', '起个', '写个', '写一', '做个', '找', '选', '装', '设置', '导出', '压缩', '调']
  const NARR = ['那天', '那次', '当时', '上次', '上回', '后来', '以前', '之前', '前天', '昨天', '上周', '刚才', '记得', '说过', '跑通', '成了', '定了', '崩了', '报错', '为什么', '怎么回事', '那么', '这版', '那版']
  const QW = ['吗', '呢', '什么', '怎么', '哪', '谁', '多少', '几', '是不是', '有没有', '能不能']
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
  const norm = Math.sqrt(idx.length || 1)
  const z = LABELS.map((_, k) => {
    let v = b[k]
    for (const [i, c] of m) v += W[k][i] * (c / norm)
    return v
  })
  const mx = Math.max(...z)
  const e = z.map((v) => Math.exp(v - mx))
  const sum = e.reduce((a, c) => a + c, 0)
  const p = e.map((v) => v / sum)
  let best = 0
  for (let k = 1; k < LABELS.length; k++) if (p[k] > p[best]) best = k
  return { label: LABELS[best], conf: p[best], p }
}

/** 只信模型：置信度 >=0.4 就照它说，低了一律 unknown。
 *  不用规则兜底——量过：规则在他自己的说法上 78.7%，换陌生人的评论只有 40.0%，
 *  兜底会把模型的 66.7% 拉到 37.8%。宁可不判，也别拿他的腔调去套别人。 */
const MEMO = new Map()
export function classifyIntent2(q) {
  const key = String(q || '')
  if (MEMO.has(key)) return MEMO.get(key)
  const m = classify2(key)
  const out = m.conf >= 0.4 ? m.label : 'unknown'
  if (MEMO.size > 128) MEMO.clear()
  MEMO.set(key, out)
  return out
}

export default classifyIntent2
