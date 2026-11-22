/**
 * 合成基准 · 陌生用户上的检索
 * ============================
 *
 *   node scripts/bench-synth.mjs              跑四张表
 *   node scripts/bench-synth.mjs --misses     追加打印融合没进前三的题
 *
 * 为什么要有这个：线上那套权重（字面 + 标题 + 向量）是在一个人身上调出来的。
 * 「换个人还灵不灵」以前只有印象，没有数。这里造六个互不相干的虚构用户，
 * 每人 60 条记忆、24 道题（正着问 / 带错字 / 绕着问各 8）。
 *
 * 三条硬约束：
 *   · 不读 data.json，不碰 ~/.dsh/consciousness-seas 与 consciousness-backups
 *   · 不写任何东西，全程只在内存里算（唯一的磁盘读是插件自己的词典和模型）
 *   · 排序范围 = 每个人自己的 60 条，跟真实识海一样：一个识海是一个人的记忆
 *
 * 打分口径（与 inject.js 现行权重一致）：
 *   字面：(片段长度 === 3 ? 2 : 1) × (log((N+1)/(df+1)) + 0.2)，标题命中每个片段再 +3
 *   向量：cosine(embedLocal(query), embedLocal(point)) × 3
 *   融合：字面 + 向量
 */
import { gramsOf } from '../lib/text.js'
import { cosine, embedTextOf } from '../lib/vectors.js'
import { embedLocal } from '../lib/embed-onnx.js'
import { USERS } from './bench-synth.data.mjs'

const START = Date.now()
const TIERS = ['正着问', '带错字', '绕着问']
const TITLE_BOOST = 3
const VEC_W = 3
const SEED = 20261114
const SHOW_MISSES = process.argv.includes('--misses')
const CONFIG_LABEL = { vec: '纯向量', fusion: '字面+向量' }

/* ------------------------------------------------------------------ 小工具 */

const rng = (() => {
  let a = SEED >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})()

/** 显示宽度：中文算 2 列，控制台里才对得齐 */
const dw = (s) => [...String(s)].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1), 0)
const padR = (s, n) => String(s) + ' '.repeat(Math.max(0, n - dw(s)))
const padL = (s, n) => ' '.repeat(Math.max(0, n - dw(s))) + String(s)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const pair = (s) => `${s.p1}/${s.p3}`

/* ------------------------------------------------------------------ 自检 */

function validate() {
  const errs = []
  if (USERS.length !== 6) errs.push(`用户数 ${USERS.length}，要求 6`)
  const ids = new Set()
  for (const u of USERS) {
    const tag = u.key || u.name
    if (!u.name || !u.field) errs.push(`${tag} 缺 name/field`)
    if (u.memories.length !== 60) errs.push(`${tag} 记忆 ${u.memories.length} 条，要求 60`)
    if (u.queries.length !== 24) errs.push(`${tag} 题 ${u.queries.length} 道，要求 24`)
    const tiers = new Map(TIERS.map((t) => [t, 0]))
    for (const m of u.memories) {
      if (ids.has(m.id)) errs.push(`记忆 id 重复：${m.id}`)
      ids.add(m.id)
      if (!m.title || !m.text) errs.push(`${m.id} 缺 title/text`)
      const len = [...String(m.text)].length
      if (len < 60 || len > 160) errs.push(`${m.id} 正文 ${len} 字，超出 60–160`)
    }
    for (const q of u.queries) {
      if (!TIERS.includes(q.tier)) errs.push(`${tag} 题档位不认识：${q.tier}`)
      else tiers.set(q.tier, tiers.get(q.tier) + 1)
      if (!u.memories.some((m) => m.id === q.want)) errs.push(`${tag} 题「${q.q}」的 want=${q.want} 不在本人记忆里`)
    }
    for (const t of TIERS) if (tiers.get(t) !== 8) errs.push(`${tag} 档位「${t}」有 ${tiers.get(t)} 道，要求 8`)
  }
  return errs
}

/* ------------------------------------------------------------------ 建池 */

/** 一个人的识海：60 条记忆 + 自己这个池子里的 df / N */
function buildPool(memories) {
  const docs = memories.map((m) => ({
    id: m.id,
    title: m.title,
    g: gramsOf(`${m.title}。${m.text}`),
    t: gramsOf(m.title),
  }))
  const df = new Map()
  for (const d of docs) for (const gram of d.g) df.set(gram, (df.get(gram) || 0) + 1)
  const N = docs.length
  const idf = (gram) => Math.log((N + 1) / ((df.get(gram) || 0) + 1)) + 0.2
  return { docs, df, N, idf }
}

/** 字面分。标题命中按片段计 +3，跟线上标题系数 3 同口径 */
function literalOf(qGrams, doc, pool) {
  let s = 0
  for (const gram of qGrams) {
    if (doc.g.has(gram)) s += (gram.length === 3 ? 2 : 1) * pool.idf(gram)
    if (doc.t.has(gram)) s += TITLE_BOOST
  }
  return s
}

const TWO_K = 10
const TWO_ALPHA = 0.3

const scoreOf = (cfg, row) => (cfg === 'vec' ? row.sim * VEC_W : row.lit + row.sim * VEC_W)

// 两阶段：先按向量取前 K 条，再在里头让字面参与。
// 2026-11-14 夜在自家题库上量出来比"全局现算"高十二个点，且分半两半同向。
// 这里加进来是为了在陌生人身上再验一次——验不过就不上线。
function orderRows(rows, cfg) {
  if (cfg !== 'two') {
    return rows
      .slice()
      .sort((a, b) => scoreOf(cfg, b) - scoreOf(cfg, a) || (a.id < b.id ? -1 : 1))
  }
  const pool = rows.slice().sort((a, b) => b.sim - a.sim).slice(0, TWO_K)
  const maxLit = Math.max(1e-6, ...pool.map((r) => r.lit))
  return pool
    .map((r) => ({ ...r, two: (1 - TWO_ALPHA) * r.sim * VEC_W + TWO_ALPHA * (r.lit / maxLit) * VEC_W }))
    .sort((a, b) => b.two - a.two || (a.id < b.id ? -1 : 1))
}

function rankOf(rows, want, cfg) {
  const sorted = orderRows(rows, cfg)
  return sorted.findIndex((r) => r.id === want) + 1
}

function stat(list, cfg) {
  let h1 = 0
  let h3 = 0
  for (const c of list) {
    const r = c.rank[cfg]
    if (r === 1) h1++
    // 2026-11-21：rankOf 找不到时回的是 0（下标 -1 加一）。0 也算「前三」的话，
    // 两阶段那条——它先把池子砍到十条，砍掉的题回 0——就会被当成前三命中，
    // @3 虚高到一百。找不到就是找不到，不给分。
    if (r >= 1 && r <= 3) h3++
  }
  return { n: list.length, h1, h3, p1: pct(h1, list.length), p3: pct(h3, list.length) }
}

/* ------------------------------------------------------------------ 主流程 */

const errs = validate()
if (errs.length) {
  console.error('数据自检没过：')
  for (const e of errs) console.error('  · ' + e)
  process.exit(1)
}

const totalMem = USERS.reduce((n, u) => n + u.memories.length, 0)
const totalQ = USERS.reduce((n, u) => n + u.queries.length, 0)
const POOL_N = USERS[0].memories.length

console.log('')
console.log(`合成基准 · 六个陌生用户 · 记忆 ${totalMem} 条（每人 ${POOL_N}） · 题 ${totalQ} 道（每人三档各 8 道）`)
console.log('字面：(三字片段×2 / 其余×1) × (log((N+1)/(df+1)) + 0.2)，标题命中 +3；向量 ×3；融合 = 字面 + 向量')
console.log(`排序范围：每个人自己的 ${POOL_N} 条。随机基线：@1 ${((1 / POOL_N) * 100).toFixed(1)}%（1/${POOL_N}），@3 ${((3 / POOL_N) * 100).toFixed(1)}%（3/${POOL_N}）`)
console.log('')

/* 建向量：360 条记忆 + 144 道题，全部本地模型，不联网 */
const t0 = Date.now()
const pointById = new Map()
for (const u of USERS) {
  for (const m of u.memories) pointById.set(m.id, { id: m.id, title: m.title, text: m.text })
}
const docVec = new Map()
for (const p of pointById.values()) docVec.set(p.id, await embedLocal(embedTextOf(p)))

const qVec = new Map()
for (const u of USERS) for (const q of u.queries) if (!qVec.has(q.q)) qVec.set(q.q, await embedLocal(q.q))
const buildMs = Date.now() - t0

const pools = new Map()
for (const u of USERS) pools.set(u.key, buildPool(u.memories))

const cases = []
for (const u of USERS) {
  const pool = pools.get(u.key)
  for (const q of u.queries) {
    const qGrams = gramsOf(q.q)
    const vec = qVec.get(q.q)
    const rows = pool.docs.map((d) => ({
      id: d.id,
      lit: literalOf(qGrams, d, pool),
      sim: cosine(vec, docVec.get(d.id)),
    }))
    const rank = { vec: rankOf(rows, q.want, 'vec'), fusion: rankOf(rows, q.want, 'fusion'), two: rankOf(rows, q.want, 'two') }
    const top = orderRows(rows, 'fusion').slice(0, 3)
    const topVec = orderRows(rows, 'vec').slice(0, 1)
    cases.push({ user: u.key, tier: q.tier, q: q.q, want: q.want, rows, rank, top, topVec })
  }
}

/* ---------------------------------------------------------------- 表一 */

console.log('【表一】六个人各自的命中率（%，@1/@3；每档 8 题，全部 24 题）')
console.log(padR('用户', 12) + padR('领域', 18) + padR('正着问', 12) + padR('带错字', 12) + padR('绕着问', 12) + padR('全部', 12))
console.log('-'.repeat(78))
for (const u of USERS) {
  const mine = cases.filter((c) => c.user === u.key)
  const cells = TIERS.map((t) => pair(stat(mine.filter((c) => c.tier === t), 'fusion')))
  console.log(padR(u.name, 12) + padR(u.field, 18) + cells.map((x) => padR(x, 12)).join('') + padR(pair(stat(mine, 'fusion')), 12))
}

/* ---------------------------------------------------------------- 表二 */

console.log('')
console.log('【表二】六个人合计（144 道题；同一批题上两种排序）')
console.log(padR('档位', 10) + padL('题数', 6) + padL('纯向量 @1/@3', 16) + padL('融合 @1/@3', 16) + padL('融合 − 纯向量', 16))
console.log('-'.repeat(66))
for (const t of TIERS) {
  const sel = cases.filter((c) => c.tier === t)
  const f = stat(sel, 'fusion')
  const v = stat(sel, 'vec')
  console.log(
    padR(t, 10) + padL(sel.length, 6)
    + padL(pair(v), 16) + padL(pair(f), 16)
    + padL(`${f.p1 - v.p1 >= 0 ? '+' : ''}${f.p1 - v.p1}pp`, 16),
  )
}
const allF = stat(cases, 'fusion')
const allV = stat(cases, 'vec')
console.log(padR('合计', 10) + padL(cases.length, 6) + padL(pair(allV), 16) + padL(pair(allF), 16)
  + padL(`${allF.p1 - allV.p1 >= 0 ? '+' : ''}${allF.p1 - allV.p1}pp`, 16))
console.log('（@1/@3 是百分比。同一道题、同一个池子，只有排序公式不同。）')
{
  const allT = stat(cases, 'two')
  console.log('')
  console.log(`两阶段（向量先取前 ${TWO_K} 条，再让字面参与）：合计 ${pair(allT)}`)
  for (const t of TIERS) {
    const s2 = stat(cases.filter((c) => c.tier === t), 'two')
    console.log(`  ${padR(t, 10)}${padL(pair(s2), 16)}`)
  }
  console.log(`  对融合：${allT.p1 - allF.p1 >= 0 ? '+' : ''}${allT.p1 - allF.p1}pp`)
}

/* ---------------------------------------------------------------- 表三 */

console.log('')
console.log('【表三】留一人验证（用其余五人选配置，再看没见过的那个）')
console.log(padR('留出用户', 12) + padR('开发集选中', 12) + padL('开发集@1', 10) + padL('留出 @1/@3（选中）', 20) + padL('留出@1 纯向量', 15) + padL('留出@1 融合', 14))
console.log('-'.repeat(86))
let heldSel = { h1: 0, h3: 0 }
let heldF = { h1: 0, h3: 0 }
let heldV = { h1: 0, h3: 0 }
let pickVec = 0
let pickFusion = 0
let selWins = 0
let selLoses = 0
for (const u of USERS) {
  const dev = cases.filter((c) => c.user !== u.key)
  const held = cases.filter((c) => c.user === u.key)
  const devF = stat(dev, 'fusion')
  const devV = stat(dev, 'vec')
  let cfg = 'fusion'
  if (devV.h1 > devF.h1) cfg = 'vec'
  else if (devV.h1 === devF.h1 && devV.h3 > devF.h3) cfg = 'vec'
  const chosenDev = cfg === 'vec' ? devV : devF
  const h = stat(held, cfg)
  const hf = stat(held, 'fusion')
  const hv = stat(held, 'vec')
  if (cfg === 'vec') pickVec++
  else pickFusion++
  if (h.h1 > (cfg === 'vec' ? hf.h1 : hv.h1)) selWins++
  if (h.h1 < (cfg === 'vec' ? hf.h1 : hv.h1)) selLoses++
  heldSel.h1 += h.h1; heldSel.h3 += h.h3
  heldF.h1 += hf.h1; heldF.h3 += hf.h3
  heldV.h1 += hv.h1; heldV.h3 += hv.h3
  console.log(
    padR(u.name, 12) + padR(CONFIG_LABEL[cfg], 12) + padL(`${chosenDev.p1}%`, 10)
    + padL(`${h.p1}/${h.p3}`, 20) + padL(`${hv.p1}%`, 15) + padL(`${hf.p1}%`, 14),
  )
}
const heldN = cases.length
console.log('-'.repeat(86))
const avg = (x) => Math.round(x / USERS.length)
console.log(
  padR('平均（六折）', 12) + padR('—', 12) + padL('—', 10)
  + padL(`${avg(heldSel.h1)}/${avg(heldSel.h3)}`, 20)
  + padL(`${pct(heldV.h1, heldN)}%`, 15) + padL(`${pct(heldF.h1, heldN)}%`, 14),
)
console.log(`选中次数：纯向量 ${pickVec} 次 / 字面+向量 ${pickFusion} 次；选中那个在留出集上比另一种好 ${selWins} 次、差 ${selLoses} 次、平 ${USERS.length - selWins - selLoses} 次`)
console.log('（五人选出来的结论，六次里有几次能带到生人身上——这才是"换个人还灵不灵"。）')

/* ---------------------------------------------------------------- 表四 */

function bootstrap(list, n = 1000) {
  const hitF = list.map((c) => (c.rank.fusion === 1 ? 1 : 0))
  const hitV = list.map((c) => (c.rank.vec === 1 ? 1 : 0))
  let fOnly = 0
  let vOnly = 0
  for (let i = 0; i < list.length; i++) {
    if (hitF[i] && !hitV[i]) fOnly++
    if (!hitF[i] && hitV[i]) vOnly++
  }
  const diffs = []
  let better = 0
  for (let b = 0; b < n; b++) {
    let sf = 0
    let sv = 0
    for (let i = 0; i < list.length; i++) {
      const k = Math.floor(rng() * list.length)
      sf += hitF[k]
      sv += hitV[k]
    }
    const d = ((sf - sv) / list.length) * 100
    diffs.push(d)
    if (d > 0) better++
  }
  diffs.sort((a, b) => a - b)
  const observed = ((hitF.reduce((a, b) => a + b, 0) - hitV.reduce((a, b) => a + b, 0)) / list.length) * 100
  return {
    lo: diffs[Math.floor(n * 0.025)],
    hi: diffs[Math.floor(n * 0.975)],
    better: better / n,
    observed,
    discordant: fOnly + vOnly,
    fOnly,
    vOnly,
  }
}

console.log('')
console.log('【表四】自助法：融合 − 纯向量 的头名命中率之差（每题重采样 1000 次，配对重采样）')
console.log(padR('口径', 10) + padL('差值', 10) + padL('95% 区间', 22) + padL('跨零', 6) + padL('融合更好', 10) + padL('题不一致(融合/向量)', 20))
console.log('-'.repeat(80))
const bootRows = [
  ['总 @1', cases],
  ...TIERS.map((t) => [`${t} @1`, cases.filter((c) => c.tier === t)]),
]
for (const [name, list] of bootRows) {
  const r = bootstrap(list)
  const sign = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}pp`
  console.log(
    padR(name, 10) + padL(sign(r.observed), 10)
    + padL(`[${sign(r.lo)}, ${sign(r.hi)}]`, 22)
    + padL(r.lo <= 0 && r.hi >= 0 ? '是' : '否', 6)
    + padL(`${Math.round(r.better * 100)}%`, 10)
    + padL(`${r.discordant}（${r.fOnly}/${r.vOnly}）`, 20),
  )
}
console.log('（"题不一致"= 同一道题两路一中对一错；只有这些题会进入差值，数量越少区间越不可信。）')

/* ------------------------------------------------------- 两路都错 */

console.log('')
const bothMiss1 = cases.filter((c) => c.rank.fusion > 1 && c.rank.vec > 1)
const bothMiss3 = cases.filter((c) => c.rank.fusion > 3 && c.rank.vec > 3)
console.log(`【两路都错】头名都没中：${bothMiss1.length} / ${cases.length} 道；其中两路都没进前三（真短板）：${bothMiss3.length} 道`)
for (const t of TIERS) {
  const a = bothMiss1.filter((c) => c.tier === t).length
  const b = bothMiss3.filter((c) => c.tier === t).length
  console.log(`  ${t}：头名没中 ${a} 道，前三没进 ${b} 道`)
}
if (bothMiss1.length) {
  console.log('  逐条（目标 / 两路各排第几 / 各自把头名给了谁）：')
  for (const c of bothMiss1) {
    console.log(`    [${c.tier}] ${c.q}`)
    console.log(`        该中：${pointById.get(c.want).title}｜融合第 ${c.rank.fusion}（头名 ${pointById.get(c.top[0].id).title}）｜纯向量第 ${c.rank.vec}（头名 ${pointById.get(c.topVec[0].id).title}）`)
  }
}
console.log('')

/* ------------------------------------------------------- 旁证：六人混池 */

const allDocs = []
for (const u of USERS) {
  for (const d of pools.get(u.key).docs) allDocs.push(d)
}
const gdf = new Map()
for (const d of allDocs) for (const gram of d.g) gdf.set(gram, (gdf.get(gram) || 0) + 1)
const gN = allDocs.length
const gidf = (gram) => Math.log((gN + 1) / ((gdf.get(gram) || 0) + 1)) + 0.2
let gF = 0
let gV = 0
for (const c of cases) {
  const qGrams = gramsOf(c.q)
  const rows = allDocs.map((d) => {
    let lit = 0
    for (const gram of qGrams) {
      if (d.g.has(gram)) lit += (gram.length === 3 ? 2 : 1) * gidf(gram)
      if (d.t.has(gram)) lit += TITLE_BOOST
    }
    return { id: d.id, lit, sim: cosine(qVec.get(c.q), docVec.get(d.id)) }
  })
  if (rankOf(rows, c.want, 'fusion') === 1) gF++
  if (rankOf(rows, c.want, 'vec') === 1) gV++
}
console.log(`旁证（不进四表）：六个人的 ${gN} 条混进同一个池子再检索，纯向量 @1 ${pct(gV, cases.length)}%、融合 @1 ${pct(gF, cases.length)}%`)
console.log(`  六人词汇刻意不重叠，这一项主要量的是「共用识海」的干扰；各自 60 条时随机基线是 ${((1 / gN) * 100).toFixed(2)}%。`)

/* ---------------------------------------------------------------- 附录 */

console.log('')
if (SHOW_MISSES) {
  const miss = cases.filter((c) => c.rank.fusion > 3)
  console.log(`融合没进前三的题（${miss.length} 道）：`)
  for (const c of miss) {
    const title = (id) => pointById.get(id).title
    const top = c.top.map((r) => `${title(r.id)}(${scoreOf('fusion', r).toFixed(2)})`).join(' / ')
    console.log(`  [${c.tier}] ${c.q}`)
    console.log(`      该中：${title(c.want)}（第 ${c.rank.fusion}）｜融合前三：${top}`)
  }
  console.log('')
}

console.log(`数据：scripts/bench-synth/{cafe,auto,exam,dog,dev,ward}.mjs（全部虚构，非真实记忆）`)
console.log(`建向量 ${docVec.size + qVec.size} 条，用时 ${(buildMs / 1000).toFixed(1)}s；总用时 ${((Date.now() - START) / 1000).toFixed(1)}s`)
console.log('全程没有读也没有写任何识海文件（data.json / vectors.json / consciousness-backups）。')
console.log('')
