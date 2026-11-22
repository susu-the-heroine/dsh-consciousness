/**
 * 大评测跑分器
 * ============
 *
 * 用真工具量：直接调 memory_search 的实现，走全链路（四层+拼音兜底+把关）。
 * 题库：scripts/data/big-eval.json，按 split 分三套：tune / accept / blind。
 *
 * 指标：头名、前三、前十、反例有回话率，外加平均延迟。
 * 只读，不强化记忆（review:false）。
 *
 * 跑法：node scripts/eval-big.mjs [--split=tune|accept|blind] [--sea=main]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const splitArg = process.argv.find((a) => a.startsWith('--split='))?.slice(8) || ''

// 评测只在临时 HOME 里跑：拷一份海过去，日志和访问计数都落在那儿，
// 不往他的真实检索日志里灌题（2026-11-16 发现会污染别名挖掘）。
const realHome = process.env.USERPROFILE || homedir()
const tmpHome = join(tmpdir(), 'c2-eval-' + Date.now())
const seaDir = join(tmpHome, '.dsh', 'consciousness-seas', sea)
mkdirSync(seaDir, { recursive: true })
const srcSea = join(realHome, '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(srcSea)) throw new Error('没有可读的海：' + srcSea)
copyFileSync(srcSea, join(seaDir, 'data.json'))
process.env.USERPROFILE = tmpHome
process.env.HOME = tmpHome
console.log(`（评测在临时目录跑，不写真实日志：${tmpHome}）`)

const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())

const bank = JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8').replace(/^\uFEFF/, ''))
const cases = bank.cases.filter((c) => c && c.q && (!splitArg || c.split === splitArg))

function idsOf(log) {
  return [...String(log || '').matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
}

const stats = {}
const rows = []
for (const c of cases) {
  const t0 = performance.now()
  let r
  try {
    r = await T.searchTool.execute({ sea, query: c.q, review: false })
  } catch (e) {
    rows.push({ q: c.q, want: c.want, kind: c.kind, split: c.split, error: String(e && e.message || e) })
    continue
  }
  const dt = performance.now() - t0
  const ids = idsOf(r && (r.log || r.text))
  const key = `${c.split}|${c.kind}`
  stats[key] = stats[key] || { n: 0, top1: 0, top3: 0, top10: 0, negHas: 0, lat: [], miss: 0 }
  const s = stats[key]
  s.n++
  s.lat.push(dt)
  if (c.want == null) {
    const log = String(r && (r.log || r.text) || '')
    const scores = [...log.matchAll(/语义\s*([\d.]+)/g)].map((m) => Number(m[1]))
    const top = scores.length ? Math.max(...scores) : 0
    s.negTop?.push(top)
    if (ids.length > 0) s.negHas++
    if (top > 0.55) s.negOver = (s.negOver || 0) + 1
    rows.push({ q: c.q, kind: c.kind, split: c.split, n: ids.length, top: +top.toFixed(2), dt: Math.round(dt) })
    continue
  }
  const rank = ids.indexOf(Number(c.want)) + 1
  if (rank === 1) s.top1++
  if (rank >= 1 && rank <= 3) s.top3++
  if (rank >= 1 && rank <= 10) s.top10++
  if (!rank) s.miss++
  rows.push({ q: c.q, want: c.want, kind: c.kind, split: c.split, rank: rank || null, dt: Math.round(dt) })
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const out = []
for (const [key, s] of Object.entries(stats).sort()) {
  const [split, kind] = key.split('|')
  const posN = s.n - (kind === 'neg' ? s.n : 0)
  const n = kind === 'neg' ? 0 : s.n
  out.push({
    split, kind, n: s.n,
    top1: n ? +(s.top1 / n * 100).toFixed(1) : null,
    top3: n ? +(s.top3 / n * 100).toFixed(1) : null,
    top10: n ? +(s.top10 / n * 100).toFixed(1) : null,
    miss: s.miss,
    negHas: kind === 'neg' ? s.negHas : null,
    negOver: kind === 'neg' ? (s.negOver || 0) : null,
    avgMs: Math.round(avg(s.lat)),
  })
}

// 按 split 汇总（不分题型）
const bySplit = {}
for (const r of rows) {
  if (!r || r.error || r.kind === 'neg') continue
  const s = bySplit[r.split] = bySplit[r.split] || { n: 0, top1: 0, top3: 0, top10: 0, lat: [] }
  s.n++
  s.lat.push(r.dt)
  if (r.rank === 1) s.top1++
  if (r.rank && r.rank <= 3) s.top3++
  if (r.rank && r.rank <= 10) s.top10++
}
for (const [split, s] of Object.entries(bySplit)) {
  out.push({
    split, kind: 'ALL',
    n: s.n,
    top1: +(s.top1 / s.n * 100).toFixed(1),
    top3: +(s.top3 / s.n * 100).toFixed(1),
    top10: +(s.top10 / s.n * 100).toFixed(1),
    avgMs: Math.round(avg(s.lat)),
  })
}

const report = { sea, at: new Date().toISOString(), cases: cases.length, stats: out, rows }
writeFileSync(join(HERE, 'data', 'big-eval-report.json'), JSON.stringify(report, null, 1), 'utf8')

console.log(`大评测：${cases.length} 题（${splitArg || '全部三套'}），sea=${sea}`)
for (const r of out) {
  console.log(
    `${r.split.padEnd(6)} ${r.kind.padEnd(7)} n=${String(r.n).padStart(3)} `
    // 2026-11-21：汇总那几行没有「没出现」这个字段，原来直接拼出来是「没出现 undefined」。
    // 实测跑一轮，三行汇总都这么打——读的人会以为统计坏了。
    + (r.top1 == null
      ? `反例有回话 ${r.negHas}/${r.n}，语义过线(>0.55) ${r.negOver}`
      : (r.miss == null
        ? `头名 ${r.top1}% 前三 ${r.top3}% 前十 ${r.top10}%`
        : `头名 ${r.top1}% 前三 ${r.top3}% 前十 ${r.top10}% 没出现 ${r.miss}`))
    + ` 延迟 ${r.avgMs}ms`
  )
}
