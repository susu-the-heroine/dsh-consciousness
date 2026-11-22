/**
 * 固定基准
 * ========
 *   node scripts/bench-baseline.mjs [--json]
 *
 * 三百二十九道真库题，出三个数：头名、前五、前十。
 * 以后每次改检索都跑它；任一掉两个点，就不许发版（preflight 会挡）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

const cases = (JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || [])
  .filter((c) => c && c.q && c.want)

let n = 0
let top1 = 0
let top5 = 0
let top10 = 0
const miss = []
for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: 10, review: false })
  const ids = []
  for (const line of String(r.log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) ids.push(Number(m[1]))
  }
  // 2026-11-21：以前一条结果都没返回的题直接跳过——分母悄悄少一题，
  // 于是「它开始答不出来了」这件事反而会让头名率变高。现在空结果也算一道，记进 miss。
  n++
  if (!ids.length) { miss.push({ q: c.q, want: Number(c.want), got: null, at: null, empty: true }); continue }
  const want = Number(c.want)
  if (ids[0] === want) top1++
  const at = ids.indexOf(want)
  if (at >= 0 && at < 5) top5++
  if (at >= 0 && at < 10) top10++
  if (at !== 0) miss.push({ q: c.q, want, got: ids[0], at })
}

const pct = (x) => Number((n ? (x / n) * 100 : 0).toFixed(2))
const out = { at: new Date().toISOString(), n, top1: pct(top1), top5: pct(top5), top10: pct(top10) }

const dir = join(HERE, 'data', 'baseline')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'latest.json'), JSON.stringify({ ...out, miss }, null, 2), 'utf8')

// 上一版：掉了两个点以上就红，交给 preflight 判断
let prev = null
try { prev = JSON.parse(readFileSync(join(dir, 'floor.json'), 'utf8')) } catch {}
if (!prev) {
  writeFileSync(join(dir, 'floor.json'), JSON.stringify({ top1: Math.max(0, out.top1 - 2), top5: Math.max(0, out.top5 - 2), top10: Math.max(0, out.top10 - 2) }, null, 2), 'utf8')
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out))
} else {
  console.log(`基准 ${n} 题：头名 ${out.top1}% · 前五 ${out.top5}% · 前十 ${out.top10}%`)
  const floor = prev || { top1: out.top1 - 2, top5: out.top5 - 2, top10: out.top10 - 2 }
  const bad = []
  if (out.top1 < floor.top1) bad.push('头名 ' + out.top1 + '% < ' + floor.top1 + '%')
  if (out.top5 < floor.top5) bad.push('前五 ' + out.top5 + '% < ' + floor.top5 + '%')
  if (out.top10 < floor.top10) bad.push('前十 ' + out.top10 + '% < ' + floor.top10 + '%')
  if (bad.length) { console.log('低于地板：' + bad.join(' · ')); process.exit(1) }
  console.log('不低于地板，可以继续。')
}
