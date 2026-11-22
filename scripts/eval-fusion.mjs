/**
 * 融合 vs 只用向量：同一批题，两种排序
 * ==================================
 *
 *   node scripts/eval-fusion.mjs [sea]
 *
 * 为什么需要：eval-labeled 只量向量那一路。注入真正用的是「字面 + 标题 + 向量」合起来的排序，
 * 而那条路一直没跟向量单路在同一批题上比过——所以"融合有没有用"以前只有我的印象，没有数。
 *
 * 这里用和 inject.js 一样的权重：字面按常见度打折（idf），标题 +3，向量 sim*3。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'main').trim() || 'main'
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())
const T = await import('file:///' + join(HERE, '..', 'lib', 'text.js').replace(/\\/g, '/') + '?v=' + Date.now())

const setPath = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : join(HERE, 'data', 'labeled-batch1.json')
const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const cases = (set.cases || []).filter((c) => c && c.q && c.want != null)
const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)

const TITLE_BOOST = 3
const grams = (s) => T.gramsOf(String(s || ''))
const docs = pts.map((p) => {
  const hs = (p.herSide && typeof p.herSide === 'object')
    ? [p.herSide.felt, p.herSide.wanted, p.herSide.did, p.herSide.regret].filter(Boolean).join(' ')
    : ''
  return {
    id: Number(p.id),
    g: grams([p.title, p.text, p.alias, hs].filter(Boolean).join(' ')),
    tset: grams(p.title),
  }
})
const df = new Map()
for (const d of docs) for (const w of d.g) df.set(w, (df.get(w) || 0) + 1)
const idfW = (w) => Math.log((docs.length + 1) / ((df.get(w) || 0) + 1)) + 0.2

const vecs = new Map()
const t0 = Date.now()
for (const p of pts) vecs.set(p.id, await E.embedLocal(V.embedTextOf(p)))
const buildMs = Date.now() - t0

// 把"正文命中"和"标题命中"分开算：之前一起乘系数，看不出来是谁在捣乱
const perCase = []
for (const c of cases) {
  const tier = c.tier || '未分档'
  const qv = await E.embedLocal(c.q)
  const qg = grams(c.q)
  const rows = pts.map((p, i) => {
    const d = docs[i]
    let body = 0
    let title = 0
    for (const w of qg) {
      if (d.g.has(w)) body += (w.length === 3 ? 2 : 1) * idfW(w)
      if (d.tset.has(w)) title += 1
    }
    // 只让稀有词算字面分：题里没有稀有词（全是"大肥鱼""睡觉"这种到处都有的），
    // 字面这一路直接不出声，交给向量——分半实验里两半打架，就是打架在这儿。
    const rareMax = Math.max(3, Math.round(docs.length * 0.05))
    let bodyRare = 0
    let titleRare = 0
    for (const w of qg) {
      if ((df.get(w) || 0) > rareMax) continue
      if (d.g.has(w)) bodyRare += (w.length === 3 ? 2 : 1) * idfW(w)
      if (d.tset.has(w)) titleRare += 1
    }
    return { id: Number(p.id), body, title, bodyRare, titleRare, sim: V.cosine(qv, vecs.get(p.id)) }
  })
  perCase.push({ tier, want: Number(c.want), rows, qRaw: String(c.q || ''), qvec: qv })
}

const tiers = new Map()
for (const c of cases) tiers.set(c.tier || '未分档', true)

const rankAt = (rows, want, bs, ts, vw, rareOnly = false) => {
  const f = (x) => rareOnly
    ? (x.bodyRare * bs + x.titleRare * ts + x.sim * vw)
    : (x.body * bs + x.title * ts + x.sim * vw)
  const ranked = rows.slice().sort((a, b) => f(b) - f(a))
  return ranked.findIndex((x) => x.id === want) + 1
}

// 分半验证：五十九道题里，头名那点差距是不是稳的。
// 只看一半的题，结论会不会翻？翻了就说明"差八个点"可能是噪声。
const halves = [perCase.filter((_, i) => i % 2 === 0), perCase.filter((_, i) => i % 2 === 1)]
const scoreAt = (sel, bs, ts) => {
  let h1 = 0
  for (const x of sel) if (rankAt(x.rows, x.want, bs, ts, 3) === 1) h1++
  return (h1 / Math.max(1, sel.length)) * 100
}
// 图游走实验：先用融合分出第一名，再把它在图上的邻居拉进来，看能不能把答案捞上来。
// 思路来自"绕着问"最差那一档——问法里没有原词，但它跟第一条记忆多半连着。
const adj = new Map()
for (const e of (data.edges || [])) {
  const a = Number(e.a || e.from), b = Number(e.b || e.to)
  if (!a || !b) continue
  if (!adj.has(a)) adj.set(a, new Set())
  if (!adj.has(b)) adj.set(b, new Set())
  adj.get(a).add(b); adj.get(b).add(a)
}
const withGraph = (rows, want, boost) => {
  const base = rows.slice().sort((x, y) => (y.body + y.title * 3 + y.sim * 3) - (x.body + x.title * 3 + x.sim * 3))
  const top = base[0]
  if (!top) return 0
  const nb = adj.get(top.id)
  if (!nb) return base.findIndex((x) => x.id === want) + 1
  const scored2 = base.map((x) => ({
    id: x.id,
    s: x.body + x.title * 3 + x.sim * 3 + (nb.has(x.id) ? boost : 0),
  })).sort((x, y) => y.s - x.s)
  return scored2.findIndex((x) => x.id === want) + 1
}
// 问句里的虚词：去掉它们再算字面分，看"绕着问"能不能好一点。
// 这些词几乎不承载内容，却会带来一堆二字片段噪声。
const FILLERS = ['为啥', '为什么', '是不是', '来着', '到底', '那个', '这个', '怎么', '什么', '吗', '呢', '呀', '啊', '了']
const stripQ = (s) => {
  let out = String(s || '')
  for (const f of FILLERS) out = out.split(f).join(' ')
  return out
}
// 伪相关反馈（Rocchio）：先把问句向量和"最像的前三条"平均一下，再重排一次。
// 短问句、口语问句最吃亏的是"它自己没几个字"，借最像那几条补点上下文，是通用手法，不依赖某人的词表。
console.log('')
console.log('伪相关反馈（问句向量 + 最像前三条的平均，再重排）：')
for (const alpha of [0, 0.2, 0.4, 0.6, 0.8]) {
  let h1 = 0, h3 = 0, n = 0
  const perTier = []
  for (const tier of tiers.keys()) {
    const sel = perCase.filter((x) => x.tier === tier)
    let a = 0, b = 0
    for (const x of sel) {
      const top3 = x.rows.slice().sort((u, v) => v.sim - u.sim).slice(0, 3)
      const dim = top3.length ? vecs.get(top3[0].id).length : 0
      const cen = new Array(dim).fill(0)
      let cnt = 0
      for (const r of top3) {
        const v = vecs.get(r.id)
        if (!v) continue
        for (let i = 0; i < dim; i++) cen[i] += v[i]
        cnt++
      }
      if (cnt) for (let i = 0; i < dim; i++) cen[i] /= cnt
      const q2 = new Array(dim)
      for (let i = 0; i < dim; i++) q2[i] = x.qvec[i] + alpha * cen[i]
      const rows2 = x.rows.map((r) => ({ id: r.id, body: r.body, title: r.title, sim: V.cosine(q2, vecs.get(r.id)) }))
      const at = rankAt(rows2, x.want, 1, 3, 3)
      if (at === 1) a++
      if (at >= 1 && at <= 3) b++
    }
    h1 += a; h3 += b; n += sel.length
    perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
  }
  console.log(`  alpha ${alpha}：总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
}

// 新近优先：同一件事有两个版本时（8.8 对 9.9），让新的那个赢。
// 只在分差很小的时候才起作用，不然会把陈年旧事全顶掉。
// 弱命中：头名分很低的时候，摆三条是不是在灌噪声？
// 线上 minScore 默认 0（等于没闸）。先量：低分那批题里，答案还中不中。
console.log('')
console.log('低分轮次里还中不中（决定要不要给 minScore 开灯）：')
{
  const byBand = [[0, 3], [3, 8], [8, 1e9]]
  for (const [lo, hi] of byBand) {
    let n = 0, h1 = 0, h3 = 0
    for (const x of perCase) {
      const best = Math.max(...x.rows.map((r) => r.body + r.title * 3 + r.sim * 3))
      if (!(best >= lo && best < hi)) continue
      n++
      const at = rankAt(x.rows, x.want, 1, 3, 3)
      if (at === 1) h1++
      if (at >= 1 && at <= 3) h3++
    }
    const name = hi > 1e8 ? '≥8' : `${lo}-${hi}`
    console.log(`  头名分 ${name}：${n} 道 · 头名 ${h1} · 前三 ${h3}` + (n ? ` · 前三占比 ${((h3 / n) * 100).toFixed(0)}%` : ''))
  }
}

// 两阶段：先用向量取前 K 条，再在里头让字面参与排序。
// 动机：全局现算时，字面会把"词对了但事不对"的拉上来（绕着问掉的那几点）；
// 只在语义候选里当微调，也许两头都保住。
// 两阶段这个提升太大，必须先验稳不稳，再谈要不要进线上。
const twoStageRank = (x, K = 10, alpha = 0.3) => {
  const pool = x.rows.slice().sort((u, v) => v.sim - u.sim).slice(0, K)
  const maxLit = Math.max(1e-6, ...pool.map((q) => q.body + q.title * 3))
  const scored2 = pool.map((r) => ({ id: r.id, s: (1 - alpha) * r.sim * 3 + alpha * ((r.body + r.title * 3) / maxLit) * 3 }))
  scored2.sort((u, v) => v.s - u.s)
  return scored2.findIndex((y) => y.id === x.want) + 1
}
const baseRank = (x) => rankAt(x.rows, x.want, 1, 3, 3)

console.log('')
console.log('两阶段 vs 现在，分半验证（头名）：')
{
  const halves = [perCase.filter((_, i) => i % 2 === 0), perCase.filter((_, i) => i % 2 === 1)]
  for (let i = 0; i < halves.length; i++) {
    const sel = halves[i]
    const a = sel.filter((x) => twoStageRank(x) === 1).length
    const b = sel.filter((x) => baseRank(x) === 1).length
    console.log(`  第 ${i + 1} 半（${sel.length} 题）：两阶段 ${((a / sel.length) * 100).toFixed(0)}% · 现在 ${((b / sel.length) * 100).toFixed(0)}%`)
  }
  // 自助法：两阶段减现在
  let better = 0, worse = 0
  const diffs = []
  for (let b = 0; b < 1000; b++) {
    let sa = 0, sb = 0
    for (let i = 0; i < perCase.length; i++) {
      const x = perCase[Math.floor(Math.random() * perCase.length)]
      if (twoStageRank(x) === 1) sa++
      if (baseRank(x) === 1) sb++
    }
    const d = (sa - sb) / perCase.length
    diffs.push(d)
    if (d > 0) better++
    if (d < 0) worse++
  }
  diffs.sort((p, q) => p - q)
  const pct = (x) => (x * 100).toFixed(1) + '%'
  console.log(`  自助法：差 ${pct(better / 1000)} 更好 / ${pct(worse / 1000)} 更差 · 95% 区间 [${pct(diffs[25])}, ${pct(diffs[975])}]`)
}

// 两阶段有个致命短板：问句里有罕见型号时，目标按向量排可能进不了前 K，
// 一合并就直接丢了（精确词那套从 90/100 掉到 50/70）。
// 改法：候选 = 向量前 K ∪ 字面前 M，再在候选里融合。两头都不丢。
// 按题分流：问句里有"稀有词"（型号、编号、专名）就走老路（字面全池参与，90/100）；
// 没有稀有词、都是日常说法的，就走两阶段（63/76）。这才是两条证据同时成立的做法。
// 阈值先试 5%，结果自家库里二十道题二十道都算"有稀有词"（库小，词都只出现十来次），
// 等于没分流。改成"只出现一两次的词"才算稀有。
// 只认"长得像型号/编号"的那种稀有：三字片段、或英数串，而且库只出现两三次。
// 二字片段几乎总会有一两个只出现一两次，用它判"稀有"等于全判稀有。
const hasRare = (x) => {
  const q2 = String(x.qRaw || '')
  for (const w of grams(q2)) {
    if (w.length < 3) continue
    if ((df.get(w) || 0) <= 3) return true
  }
  for (const w of (q2.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) || [])) {
    if ((df.get(w) || 0) <= 3) return true
  }
  return false
}
const gatedRank = (x) => {
  if (hasRare(x)) return rankAt(x.rows, x.want, 1, 3, 3)
  const pool = x.rows.slice().sort((u, v) => v.sim - u.sim).slice(0, 10)
  const maxLit = Math.max(1e-6, ...pool.map((q) => q.body + q.title * 3))
  const scored2 = pool.map((r) => ({ id: r.id, s: 0.7 * r.sim * 3 + 0.3 * ((r.body + r.title * 3) / maxLit) * 3 }))
  scored2.sort((u, v) => v.s - u.s)
  return scored2.findIndex((y) => y.id === x.want) + 1
}
console.log('')
console.log('按题分流（有稀有词走老路，没有走两阶段）：')
{
  let h1 = 0, h3 = 0, n = 0
  const perTier = []
  for (const tier of tiers.keys()) {
    const sel = perCase.filter((x) => x.tier === tier)
    let a = 0, b = 0
    let rareN = 0
    for (const x of sel) {
      if (hasRare(x)) rareN++
      const at = gatedRank(x)
      if (at === 1) a++
      if (at >= 1 && at <= 3) b++
    }
    h1 += a; h3 += b; n += sel.length
    perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}（稀有 ${rareN}）`)
  }
  console.log(`  总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
}

console.log('')
console.log('两阶段加强版（向量前 K ∪ 字面前 M）：')
for (const K of [10, 20]) {
  for (const M of [10, 20]) {
    for (const alpha of [0.3]) {
      let h1 = 0, h3 = 0, n = 0
      const perTier = []
      for (const tier of tiers.keys()) {
        const sel = perCase.filter((x) => x.tier === tier)
        let a = 0, b = 0
        for (const x of sel) {
          const byVec = x.rows.slice().sort((u, v) => v.sim - u.sim).slice(0, K)
          const byLit = x.rows.slice().sort((u, v) => (v.body + v.title * 3) - (u.body + u.title * 3)).slice(0, M)
          const set = new Map()
          for (const r of [...byVec, ...byLit]) set.set(r.id, r)
          const pool = [...set.values()]
          const maxLit = Math.max(1e-6, ...pool.map((q) => q.body + q.title * 3))
          const scored2 = pool.map((r) => ({ id: r.id, s: (1 - alpha) * r.sim * 3 + alpha * ((r.body + r.title * 3) / maxLit) * 3 }))
          scored2.sort((u, v) => v.s - u.s)
          const at = scored2.findIndex((y) => y.id === x.want) + 1
          if (at === 1) a++
          if (at >= 1 && at <= 3) b++
        }
        h1 += a; h3 += b; n += sel.length
        perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
      }
      console.log(`  K=${K} M=${M}：总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
    }
  }
}

console.log('')
console.log('两阶段（向量先取前 K，再让字面参与）：')
for (const K of [10, 20, 40]) {
  for (const alpha of [0.3, 0.6]) {
    let h1 = 0, h3 = 0, n = 0
    const perTier = []
    for (const tier of tiers.keys()) {
      const sel = perCase.filter((x) => x.tier === tier)
      let a = 0, b = 0
      for (const x of sel) {
        const pool = x.rows.slice().sort((u, v) => v.sim - u.sim).slice(0, K)
        const scored2 = pool.map((r) => {
          const lit = r.body + r.title * 3
          const norm = Math.max(1e-6, Math.max(...pool.map((q) => q.body + q.title * 3)))
          return { id: r.id, s: (1 - alpha) * r.sim * 3 + alpha * (lit / norm) * 3 }
        })
        scored2.sort((u, v) => v.s - u.s)
        const at = scored2.findIndex((y) => y.id === x.want) + 1
        // 不在候选里就算没进前三
        if (at === 1) a++
        if (at >= 1 && at <= 3) b++
      }
      h1 += a; h3 += b; n += sel.length
      perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
    }
    console.log(`  K=${K} alpha=${alpha}：总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
  }
}

console.log('')
console.log('新近加权（分越低越靠后；alpha=0 就是现状）：')
{
  const nowTs = Date.now()
  const fresh = new Map()
  for (const p of pts) {
    const ts = Number(p.lastSeen || p.born || 0) || 0
    const days = ts ? (nowTs - ts) / 86400000 : 999
    fresh.set(Number(p.id), Math.exp(-days / 30))
  }
  for (const alpha of [0, 0.05, 0.1, 0.2, 0.4]) {
    let h1 = 0, h3 = 0, n = 0
    const perTier = []
    for (const tier of tiers.keys()) {
      const sel = perCase.filter((x) => x.tier === tier)
      let a = 0, b = 0
      for (const x of sel) {
        const rows2 = x.rows.map((r) => ({ id: r.id, body: r.body, title: r.title, sim: r.sim }))
        const rank = (rr) => {
          const scored2 = rr.map((r) => ({ id: r.id, s: (r.body + r.title * 3 + r.sim * 3) * (1 + alpha * (fresh.get(r.id) || 0)) }))
          scored2.sort((u, v) => v.s - u.s)
          return scored2.findIndex((y) => y.id === x.want) + 1
        }
        const at = rank(rows2)
        if (at === 1) a++
        if (at >= 1 && at <= 3) b++
      }
      h1 += a; h3 += b; n += sel.length
      perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
    }
    console.log(`  alpha ${alpha}：总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
  }
}

console.log('')
console.log('两路都进不了前三的题（真短板；只列前十五道）：')
{
  let bothFail = 0
  const lines = []
  for (const x of perCase) {
    const byVec = rankAt(x.rows, x.want, 0, 0, 3)
    const byLit = rankAt(x.rows, x.want, 1, 3, 0)   // 只字面，权重给足
    if (byVec > 3 && byLit > 3) {
      bothFail++
      if (lines.length < 15) {
        const target = pts.find((p) => Number(p.id) === x.want)
        lines.push(`  [${x.tier}] ${x.qRaw} → 想要 #${x.want}（${String(target && target.title || '').slice(0, 20)}）`
          + ` 向量排 ${byVec} · 字面排 ${byLit}`)
      }
    }
  }
  for (const l of lines) console.log(l)
  console.log(`  合计 ${bothFail} / ${perCase.length} 道`)
}

console.log('')
console.log('去掉问句虚词再算（正文1 标题3）：')
{
  let h1 = 0, h3 = 0, n = 0
  const perTier = []
  for (const tier of tiers.keys()) {
    const sel = perCase.filter((x) => x.tier === tier)
    let a = 0, b = 0
    for (const x of sel) {
      // 重新算一份字面分：用剥掉虚词的问句
      const qg2 = grams(stripQ(x.qRaw || ''))
      const rows2 = x.rows.map((r, i) => {
        const d = docs[i]
        let body = 0, title = 0
        for (const w of qg2) {
          if (d.g.has(w)) body += (w.length === 3 ? 2 : 1) * idfW(w)
          if (d.tset.has(w)) title += 1
        }
        return { id: r.id, body, title, sim: r.sim }
      })
      const at = rankAt(rows2, x.want, 1, 3, 3)
      if (at === 1) a++
      if (at >= 1 && at <= 3) b++
    }
    h1 += a; h3 += b; n += sel.length
    perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
  }
  console.log(`  总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
}

console.log('')
console.log('图游走实验（第一名在边上的邻居加一点分）：')
for (const boost of [0, 0.5, 1, 2, 3]) {
  let h1 = 0, h3 = 0, n = 0
  const perTier = []
  for (const tier of tiers.keys()) {
    const sel = perCase.filter((x) => x.tier === tier)
    let a = 0, b = 0
    for (const x of sel) {
      const at = withGraph(x.rows, x.want, boost)
      if (at === 1) a++
      if (at >= 1 && at <= 3) b++
    }
    h1 += a; h3 += b; n += sel.length
    perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
  }
  console.log(`  加分 ${boost}：总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
}

console.log('')
console.log('只让稀有词算字面分（正文1 标题3）：')
{
  let h1 = 0, h3 = 0, n = 0
  const perTier = []
  for (const tier of tiers.keys()) {
    const sel = perCase.filter((x) => x.tier === tier)
    let a = 0, b = 0
    for (const x of sel) {
      const at = rankAt(x.rows, x.want, 1, 3, 3, true)
      if (at === 1) a++
      if (at >= 1 && at <= 3) b++
    }
    h1 += a; h3 += b; n += sel.length
    perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
  }
  console.log(`  总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
}

// 自助法：这道题集里，"某配置比某配置好"到底能不能当真。
// 重采样一千次，看差的分布跨不跨零。跨零就是噪声。
const boot = (aCfg, bCfg, n = 1000) => {
  const hitOf = (x, cfg) => (rankAt(x.rows, x.want, cfg[0], cfg[1], 3) === 1 ? 1 : 0)
  let better = 0, worse = 0
  const diffs = []
  for (let b = 0; b < n; b++) {
    let sa = 0, sb = 0
    for (let i = 0; i < perCase.length; i++) {
      const x = perCase[Math.floor(Math.random() * perCase.length)]
      sa += hitOf(x, aCfg); sb += hitOf(x, bCfg)
    }
    const d = (sa - sb) / perCase.length
    diffs.push(d)
    if (d > 0) better++
    if (d < 0) worse++
  }
  diffs.sort((p, q) => p - q)
  const lo = diffs[Math.floor(n * 0.025)]
  const hi = diffs[Math.floor(n * 0.975)]
  return { better, worse, lo, hi }
}
console.log('')
console.log('自助法（一千次重采样，头名命中率之差）：')
for (const [name, cfg] of [['纯向量', [0, 0]], ['正文1/标题3', [1, 3]], ['正文0.3/标题2', [0.3, 2]]]) {
  const r = boot(cfg, [0, 0])
  const pct = (x) => (x * 100).toFixed(1) + '%'
  console.log(`  ${name} 对 纯向量：差 ${pct(r.better / 1000)} ~ 范围 [${pct(r.lo)}, ${pct(r.hi)}]（${r.better} 次更好 / ${r.worse} 次更差）`)
}

console.log('')
console.log('分半验证（头名命中率）：')
for (let i = 0; i < halves.length; i++) {
  console.log(`  第 ${i + 1} 半（${halves[i].length} 题）  纯向量 ${scoreAt(halves[i], 0, 0).toFixed(0)}%`
    + `   正文0.3/标题2 ${scoreAt(halves[i], 0.3, 2).toFixed(0)}%`
    + `   正文1/标题3（今晚之前） ${scoreAt(halves[i], 1, 3).toFixed(0)}%`)
}

console.log(`海 ${sea} · 记忆 ${pts.length} · 题 ${cases.length} · 建向量 ${(buildMs / 1000).toFixed(1)}s`)
console.log('')
console.log('正文系数 / 标题系数 扫描（向量固定 3），报的是三档平均 @1 / @3：')
for (const bs of [0, 0.3]) {
  for (const ts of [1, 2, 3]) {
    let h1 = 0, h3 = 0, n = 0
    const perTier = []
    for (const tier of tiers.keys()) {
      const sel = perCase.filter((x) => x.tier === tier)
      let a = 0, b = 0
      for (const x of sel) {
        const at = rankAt(x.rows, x.want, bs, ts, 3)
        if (at === 1) a++
        if (at >= 1 && at <= 3) b++
      }
      h1 += a; h3 += b; n += sel.length
      perTier.push(`${tier} ${((a / sel.length) * 100).toFixed(0)}/${((b / sel.length) * 100).toFixed(0)}`)
    }
    console.log(`正文 ${String(bs).padEnd(5)} 标题 ${String(ts).padEnd(4)} 总 ${((h1 / n) * 100).toFixed(0)}% / ${((h3 / n) * 100).toFixed(0)}%   ` + perTier.join(' · '))
  }
}
