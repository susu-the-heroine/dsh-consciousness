/**
 * 重排影子对比（用三百二十九题当留出集）
 * ====================================
 *   node scripts/bench-rerank-shadow.mjs
 *
 * 没有用户反馈的情况下，拿基准题当留出集：
 * 每题跑一遍检索，取头一条，算它的重排概率；再看它是不是题里要的那条。
 * 对的和错的，概率分布分开多少——分开得多，说明这道影子有用。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')
const { readSea } = await import(LIB + '/store.js')
const RM = await import(LIB + '/rerank-learned.js')

const cases = (JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || [])
  .filter((c) => c && c.q && c.want)
const sea = 'main'
const data = readSea(sea)
const byId = new Map(((data && data.points) || []).map((p) => [Number(p.id), p]))
const model = RM.loadModel()

const good = []
const bad = []
// 2026-11-21：检索回空或头名查不到库里的题，原来是「悄悄跳过」——
// 三百二十九题只报了对的加错的，剩下几道不吭声，分母悄悄变小。现在摊开报。
let skipped = 0
for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: 3, review: false })
  const ids = []
  for (const line of String((r && r.log) || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) ids.push(Number(m[1]))
  }
  if (!ids.length) { skipped++; continue }
  const top = byId.get(ids[0])
  if (!top) { skipped++; continue }
  const p = RM.probOf(RM.featuresOf(c.q, top, 0), model) ?? 0
  if (Number(c.want) === ids[0]) good.push(p)
  else bad.push(p)
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const pct = (a, t) => (a.length ? (a.filter((x) => x >= t).length / a.length) * 100 : 0)

console.log(`答对的 ${good.length} 题 · 答错的 ${bad.length} 题 · 没结果被跳过 ${skipped} 题（共 ${cases.length}）`)
console.log(`重排概率：对的均值 ${avg(good).toFixed(3)} · 错的均值 ${avg(bad).toFixed(3)}`)
for (const t of [0.3, 0.5, 0.7]) {
  console.log(`  阈值 ${t}：对的留下 ${pct(good, t).toFixed(1)}% · 错的误留 ${pct(bad, t).toFixed(1)}%`)
}
console.log('（影子对比：同一份权重在留出集上的分开程度。要不要换权重，看这张表。）')
