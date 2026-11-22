/**
 * 字面路 A/B：常见词降权到底帮不帮
 * ================================
 *
 * 生产里"字面"这条路的分数，五十九题那套（向量）测不到。
 * 这里用一个**简化复刻**（同样的二字片段命中、标题加成）跑两版：
 *   A 版：命中就加分（旧行为）
 *   B 版：命中三成以上记忆都有的词，不算分（今天加的那个闸）
 *
 * 这是代理指标，不是生产真值——两版用同一把尺，看"变好还是变坏"是可信的，
 * 具体百分之几别拿去跟向量那条比。
 *
 *   node scripts/literal-ab.mjs
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json'), 'utf8').replace(/^\uFEFF/, '').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
const cases = JSON.parse(readFileSync(join(HERE, 'data', 'labeled-batch1.json'), 'utf8')).cases || []
let TITLE_BOOST = 3

const grams = (s) => {
  const t = String(s || '').replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}

const docs = pts.map((p) => ({
  id: Number(p.id),
  title: String(p.title || ''),
  // 别名进不进字面池，是今晚动过的一个改动；这里留一份"不进"的，好量它到底值不值。
  all: grams([p.title, p.alias, p.text].filter(Boolean).join(' ')),
  allNoAlias: grams([p.title, p.text].filter(Boolean).join(' ')),
  tset: grams(p.title),
}))

// 每个二字片段在多少条记忆的标题/别名里出现
const df = new Map()
for (const d of docs) {
  for (const w of grams(d.title + ' ' + String(d.alias || ''))) df.set(w, (df.get(w) || 0) + 1)
}
const tooCommon = (w) => (df.get(w) || 0) > Math.max(8, docs.length * 0.3)

// 记忆长度归一化用：docs 里各条文本多长
let _lenSum = 0
for (const d of docs) { d.len = d.all.size; _lenSum += d.len }
const _lenAvg = _lenSum / Math.max(1, docs.length)

// idf：一个片段在多少条里出现，越常见权重越低。
// 这是为了治「大肥鱼这名谁起的」这类——名字到处都在，字面分被它撑爆。
const idf = new Map()
for (const d of docs) {
  for (const w of d.all) idf.set(w, (idf.get(w) || 0) + 1)
}
const N = docs.length
const wOf = (w) => Math.log((N + 1) / ((idf.get(w) || 0) + 1)) + 0.2

const run = (useGate, useLenNorm, useAlias = true, useIdf = false) => {
  const byTier = new Map()
  const missed = []
  for (const c of cases) {
    const q = String(c.q || '').trim()
    const want = Number(c.want)
    if (!q || !want) continue
    const qg = [...grams(q)]
    const scored = docs.map((d) => {
      let hit = 0
      for (const w of qg) {
        if (useGate && tooCommon(w)) continue
        const pool = useAlias ? d.all : d.allNoAlias
        const baseW = w.length === 3 ? 2 : 1
        if (pool.has(w)) hit += useIdf ? baseW * wOf(w) : baseW
        if (d.tset.has(w)) hit += TITLE_BOOST
      }
      // 长度归一化：长记忆天然撞得多，不归一化就是"谁写得多谁被翻出来"。
      if (useLenNorm && hit > 0) hit = hit / Math.sqrt(Math.max(1, d.len) / Math.max(1, _lenAvg))
      return { id: d.id, hit }
    }).sort((a, b) => b.hit - a.hit)
    const pos = scored.findIndex((x) => x.id === want) + 1
    const t = String(c.tier || '未标')
    if (!byTier.has(t)) byTier.set(t, { n: 0, at1: 0, at3: 0 })
    const g = byTier.get(t)
    g.n++
    if (pos === 1) g.at1++
    if (pos > 0 && pos <= 3) g.at3++
    if (pos > 3 && missed.length < 6) missed.push({ q, want, pos, tier: t })
  }
  return { byTier, missed }
}

const A = run(false, false, true)
const B = run(true, false, true)
const C = run(false, true, true)
const D = run(false, false, false)   // 别名不进池
const E = run(false, false, true, true)   // idf 加权

// 标题加权扫一遍：现在默认 3，看看 2 和 4 差多少。只量不采纳，除非明显更好。
const sweep = []
for (const tb of [2, 3, 4, 5]) {
  TITLE_BOOST = tb
  const r = run(false, false, true, true)
  sweep.push({ tb, r })
}
TITLE_BOOST = 3

console.log('字面路 A/B/C（简化复刻，代理指标）')
console.log('A=旧行为  B=常见词闸  C=长度归一化  D=别名不进池  E=idf 加权')
for (const [t, a] of A.byTier) {
  const b = B.byTier.get(t)
  const c = C.byTier.get(t)
  const f = (x) => (x * 100).toFixed(1)
  console.log(`  ${t}  题 ${a.n}   A: @1 ${f(a.at1 / a.n)}% @3 ${f(a.at3 / a.n)}%`
    + `   B: @1 ${f(b.at1 / b.n)}% @3 ${f(b.at3 / b.n)}%`
    + `   C: @1 ${f(c.at1 / c.n)}% @3 ${f(c.at3 / c.n)}%`
    + `   D: @1 ${f(D.byTier.get(t).at1 / D.byTier.get(t).n)}% @3 ${f(D.byTier.get(t).at3 / D.byTier.get(t).n)}%`
    + `   E: @1 ${f(E.byTier.get(t).at1 / E.byTier.get(t).n)}% @3 ${f(E.byTier.get(t).at3 / E.byTier.get(t).n)}%`)
}
console.log('')
console.log('')
console.log('标题加权扫描（在 idf 开的情况下）：')
for (const s of sweep) {
  const parts = [...s.r.byTier].map(([t2, g]) => `${t2} @3 ${((g.at3 / g.n) * 100).toFixed(1)}%`)
  console.log(`  加权 ${s.tb}：` + parts.join(' · '))
}
console.log('')
console.log('C 还是没进前三的：')
for (const m of C.missed) console.log(`  [${m.tier}] ${m.q} → 想要 #${m.want}，排 ${m.pos}`)
