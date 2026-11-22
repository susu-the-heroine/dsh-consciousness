/**
 * 朴素基线：BM25（纯字面，不训练、不向量）
 * =========================================
 *
 * 为什么要有它：没有基线，"七成命中"是多是少没人知道。
 * 拿同一个五十九题、同一个库，跑一个最笨但公认的方法，才知道自己到底赢在哪。
 *
 *   node scripts/baseline-bm25.mjs
 *
 * 只读，不改库。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = 'main'
const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
const byId = new Map(pts.map((p) => [Number(p.id), p]))
// 2026-11-21：它要的 labeled-batch1.json 根本不在（实测 ENOENT，整份跑不起来）。
// 现存的 labeled-batch.json 是另一种形状：裸数组、字段是 q/top/conf/note，没有 want 和 tier，
// 拿过来顶是错配，所以不顶。缺题就说缺题，别抛一段栈。
const casesPath = join(HERE, 'data', 'labeled-batch1.json')
if (!existsSync(casesPath)) {
  console.log('题文件不在：' + casesPath)
  console.log('这份基线现在跑不了。要做，得先有带 want 和 tier 的题库；')
  console.log('现存的 labeled-batch.json 是另一种形状（q/top/conf/note），不能直接顶。')
  process.exit(2)
}
const cases = JSON.parse(readFileSync(casesPath, 'utf8')).cases || []

// 切词：中文用二字片段，英文/数字整体，去停用词（只留最常见的那几个）
const STOP = new Set(['的了', '是什', '什么', '怎么', '为什', '么样', '我们', '你们', '这个', '那个'])
const toks = (s) => {
  const out = []
  const t = String(s || '')
  for (const seg of t.match(/[\u4e00-\u9fa5]+/g) || []) {
    for (let i = 0; i + 2 <= seg.length; i++) {
      const g = seg.slice(i, i + 2)
      if (!STOP.has(g)) out.push(g)
    }
  }
  for (const w of t.toLowerCase().match(/[a-z0-9]{2,}/g) || []) out.push(w)
  return out
}

const docs = pts.map((p) => ({
  id: Number(p.id),
  tf: (() => {
    const m = new Map()
    for (const w of toks([p.title, p.alias, p.text].filter(Boolean).join(' '))) m.set(w, (m.get(w) || 0) + 1)
    return m
  })(),
  len: 0,
}))
let total = 0
for (const d of docs) { d.len = [...d.tf.values()].reduce((a, b) => a + b, 0); total += d.len }
const avg = total / Math.max(1, docs.length)
const df = new Map()
for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1)

const k1 = 1.5, b = 0.75
const N = docs.length
const score = (q, d) => {
  let s = 0
  for (const w of toks(q)) {
    const f = d.tf.get(w) || 0
    if (!f) continue
    const idf = Math.log(1 + (N - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5))
    s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg))
  }
  return s
}

const tier = new Map()
for (const c of cases) {
  const q = String(c.q || '').trim()
  const want = Number(c.want)
  if (!q || !want) continue
  const ranked = docs.map((d) => ({ id: d.id, s: score(q, d) })).sort((a, b2) => b2.s - a.s)
  const pos = ranked.findIndex((x) => x.id === want) + 1
  const t = String(c.tier || '未标')
  if (!tier.has(t)) tier.set(t, { n: 0, at1: 0, at3: 0 })
  const g = tier.get(t)
  g.n++
  if (pos === 1) g.at1++
  if (pos > 0 && pos <= 3) g.at3++
}

console.log(`BM25 基线 · 海 ${sea} · 活 ${pts.length} 条 · 题 ${cases.length}`)
for (const [t, g] of tier) {
  console.log(`  ${t}  题 ${g.n}   命中@1 ${g.at1}/${g.n} (${Math.round((g.at1 / g.n) * 100)}%)   命中@3 ${g.at3}/${g.n} (${Math.round((g.at3 / g.n) * 100)}%)`)
}
console.log('')
console.log('这是纯字面的下限。识海用八路融合，正着问 70%、绕着问 53%——差距就是"多出来的那几路"值多少。')
