/**
 * 端到端检索基线（走真实工具，不是只测向量层）
 * ============================================
 *
 * 为什么：向量层评测只覆盖五层里的一层。要调排序权重，得先有一条能跑真实检索的路。
 * 现成的 searchTool 可以直接在进程内调，返回的就是线上同一套结果——不用新开 HTTP 路由。
 *
 * 跑法：node scripts/rank-baseline.mjs [评测集路径] [--limit 10]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const setPath = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : join(HERE, 'data', 'recall-set-v2.json')
const li = process.argv.indexOf('--limit')
const LIMIT = li >= 0 ? Number(process.argv[li + 1]) || 10 : 10

const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())
const tool = T.searchTool
const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const cases = (set.cases || []).filter((c) => c && c.q)

/** 从工具返回的正文里按顺序取编号 */
function idsOf(res) {
  const txt = res && res.log ? String(res.log) : ''
  const out = []
  const re = /·\s*#(\d+)/g
  let m
  while ((m = re.exec(txt))) out.push(Number(m[1]))
  return out
}

let pos = 0, h1 = 0, h3 = 0, h10 = 0
let neg = 0, negWeak = 0
const misses = []
const t0 = Date.now()

for (const c of cases) {
  let res = null
  try { res = await tool.execute({ query: c.q, limit: LIMIT }) } catch (e) { res = { log: '' } }
  const ids = idsOf(res)
  const txt = String((res && res.log) || '')
  if (c.want == null) {
    neg++
    if (txt.includes('凑出来的') || txt.includes('语义保底')) negWeak++
    continue
  }
  pos++
  const wantSet = [c.want, ...(Array.isArray(c.also) ? c.also : [])]
  const at = ids.findIndex((id) => wantSet.includes(id))
  if (at === 0) h1++
  if (at >= 0 && at < 3) h3++
  if (at >= 0 && at < 10) h10++
  if (at !== 0) misses.push({ q: c.q, want: c.want, at: at < 0 ? '10+' : at + 1 })
}

const pct = (a, b) => ((a / (b || 1)) * 100).toFixed(0) + '%'
console.log(`真实检索基线 · 正向 ${pos} · 反例 ${neg} · 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
console.log('')
console.log(`头名    ${h1}/${pos}  ${pct(h1, pos)}`)
console.log(`前三    ${h3}/${pos}  ${pct(h3, pos)}`)
console.log(`前十    ${h10}/${pos}  ${pct(h10, pos)}`)
console.log(`反例被判"凑出来的"  ${negWeak}/${neg}  ${pct(negWeak, neg)}`)
console.log('')
console.log('没进头名（前几条）：')
for (const m of misses.slice(0, 8)) console.log(`  ${m.q} → 想要 #${m.want}，排 ${m.at}`)

const outFile = join(HERE, 'data', 'rank-baseline.json')
writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), set: setPath, limit: LIMIT, pos, h1, h3, h10, neg, negWeak, misses }, null, 1), 'utf8')
console.log('')
console.log('已存:', outFile)
