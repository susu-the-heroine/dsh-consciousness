/**
 * 别名自学 · 第三步（从真实检索日志挖候选）
 * ======================================
 *
 * 前两步（alias-suggest / alias-learn2）分别挖模板和「问句重复」；这一步补第三种信号：
 *   **当时没认出来的问法**——日志里 top1 分数 < 0.8 的那些。
 *
 * 只出候选，不写 data.json、不碰 alias 字段：
 *   - 候选区：scripts/data/alias-candidates-auto.json（机器看）
 *   - 人看的：scripts/data/alias-candidates-auto.md
 *   - 下一道验收在 alias-verify.mjs（收工前会做）
 *
 * 跑法：node scripts/alias-learn3.mjs [--sea=main] [--min=2]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.USERPROFILE || homedir()
const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const MIN = Math.max(2, Number(process.argv.find((a) => a.startsWith('--min='))?.slice(6)) || 2)

const D = join(HOME, '.dsh')
const LOG = join(D, 'consciousness-search-log.jsonl')
const DATA = join(D, 'consciousness-seas', sea, 'data.json')

const data = JSON.parse(readFileSync(DATA, 'utf8').replace(/^\uFEFF/, ''))
const points = (data.points || []).filter((p) => p && !p.dead && p.id != null)
const byId = new Map(points.map((p) => [Number(p.id), p]))

const known = new Set()
for (const p of points) for (const a of Array.isArray(p.alias) ? p.alias : []) known.add(String(a).trim())

// 评测自己灌进来的题不算"他会怎么说"——题库里的问法整句排除
const evalQs = new Set()
try {
  const bank = JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8'))
  for (const c of bank.cases || []) if (c && c.q) evalQs.add(String(c.q))
} catch {}
// 老评测脚本（eval-tool）里那组反例句也在污染日志：整句收进来排掉
try {
  const src = readFileSync(join(HERE, 'eval-tool.mjs'), 'utf8')
  const i = src.indexOf('const NEG')
  if (i >= 0) {
    const seg = src.slice(i, src.indexOf(']', i) + 1)
    for (const m of seg.matchAll(/'([^']{4,40})'/g)) evalQs.add(m[1])
  }
} catch {}
// 合成题的特征：同一条问句被脚本反复跑出十几次以上；真实问法很少这样重复
const MAX_TIMES = 8

const SKIP = /(你还记得吗|这是哪件事|什么来着|记不记得|怎么样|怎么办|干什么)/
function shell(q) {
  return String(q || '')
    .trim()
    .replace(/[（(][^）)]{0,12}[）)]/g, '')
    .replace(/[，。！？、：；\s]+$/g, '')
    .trim()
}
function plausible(s) {
  const n = [...s].length
  if (n < 2 || n > 12) return false
  if (SKIP.test(s)) return false
  if (/[?？!！]/.test(s)) return false
  return /[\u4e00-\u9fa5]/.test(s)
}

const hits = new Map()
let lines = 0
let low = 0
for (const ln of readFileSync(LOG, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  if (!ln) continue
  lines++
  let r
  try { r = JSON.parse(ln) } catch { continue }
  if (!r || r.k !== 's' || r.sea !== sea) continue
  if (evalQs.has(String(r.q))) continue
  if (r.src === 'eval') continue // 评测自己的题不算真实问法
  const top = Array.isArray(r.top) ? r.top[0] : null
  if (!top || Number(top.s) >= 0.8) continue
  const phrase = shell(r.q)
  if (!plausible(phrase)) continue
  if (known.has(phrase)) continue
  const pt = byId.get(Number(top.id))
  if (!pt) continue
  low++
  const h = hits.get(phrase) || { point: Number(top.id), n: 0, s: 0, samples: [] }
  h.n++
  h.s += Number(top.s) || 0
  if (h.samples.length < 3) h.samples.push(String(r.q).slice(0, 40))
  hits.set(phrase, h)
}

const cands = [...hits.entries()]
  .map(([phrase, h]) => ({
    phrase,
    point: h.point,
    title: String(byId.get(h.point)?.title || '').slice(0, 40),
    times: h.n,
    avgTop: +(h.s / h.n).toFixed(3),
    samples: h.samples,
  }))
  .filter((c) => c.times >= MIN && c.times <= MAX_TIMES)
  .sort((a, b) => b.times - a.times || a.avgTop - b.avgTop)
  .slice(0, 60)

const outPath = join(HERE, 'data', 'alias-candidates-auto.json')
writeFileSync(outPath, JSON.stringify({
  _说明: `从真实检索日志挖的候选别名（${new Date().toISOString()}，sea=${sea}）。只进候选区，绝不自动并；times=问过几次，avgTop=当时最高分（越低越像没认出来）。`,
  sea, logLines: lines, lowScoreQueries: low, uniqueLow: hits.size, candidates: cands,
}, null, 1), 'utf8')

const md = [
  '# 别名候选（从低分问法挖的）',
  '',
  `日志 ${lines} 行；低分问法 ${low} 条；去重 ${hits.size} 个；反复出现 ${cands.length} 个（≥${MIN} 次）。`,
  '',
  '| 问法 | 指向 | 次数 | 当时最高分 |',
  '| --- | --- | --- | --- |',
  ...cands.map((c) => `| ${c.phrase} | #${c.point} ${c.title} | ${c.times} | ${c.avgTop} |`),
].join('\n')
writeFileSync(join(HERE, 'data', 'alias-candidates-auto.md'), md, 'utf8')

console.log(`日志 ${lines} 行；低分 ${low} 条；去重 ${hits.size}；候选 ${cands.length} -> ${outPath}`)
for (const c of cands.slice(0, 15)) console.log(`  ${String(c.times).padStart(3)}次 ${c.avgTop}  「${c.phrase}」 -> #${c.point} ${c.title}`)
