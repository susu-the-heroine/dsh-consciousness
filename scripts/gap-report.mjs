/**
 * 分差报表：第二名和第三名差多少
 * ==============================
 *
 *   node scripts/gap-report.mjs [条数]
 *
 * 为什么需要：注入摆几条，是我凭感觉定的（relSlots 默认 3）。
 * 要是第三名的分经常只有第二名的一个零头，那第三条就是碎片，摆上去占地方。
 * 这个脚本只读 pick-log 里的 relScore（每轮记了前八名的分），把分差摊开看。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LIMIT = Math.max(20, Number(process.argv[2]) || 400)
const logPath = join(homedir(), '.dsh', 'consciousness-pick-log.jsonl')
if (!existsSync(logPath)) {
  console.log('没有 pick-log，先跑几轮再来看。')
  process.exit(1)
}

const rows = []
for (const line of readFileSync(logPath, 'utf8').split('\n')) {
  if (!line.trim()) continue
  try {
    const r = JSON.parse(line)
    if (Array.isArray(r.relScore) && r.relScore.length >= 2) rows.push(r)
  } catch {}
}
const use = rows.slice(-LIMIT)
if (!use.length) {
  console.log('日志里还没有带分数的行。')
  process.exit(0)
}

const ratios = []
let thirdUnderTenth = 0
let threeOrLess = 0
let gapSum = 0
for (const r of use) {
  const s = r.relScore.map((x) => Number(Array.isArray(x) ? x[1] : 0) || 0)
  if (s.length < 3) { threeOrLess++; continue }
  const second = s[1]
  const third = s[2]
  if (second <= 0) continue
  const ratio = third / second
  ratios.push(ratio)
  gapSum += ratio
  if (ratio < 0.1) thirdUnderTenth++
}

ratios.sort((a, b) => a - b)
const pct = (x) => (x * 100).toFixed(0) + '%'
const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0

console.log(`看过 ${use.length} 轮 · 其中不到三名候选的 ${threeOrLess} 轮`)
console.log(`第三名 / 第二名的分比：中位 ${pct(median)} · 平均 ${pct(gapSum / Math.max(1, ratios.length))}`)
console.log(`第三名不到第二名一成的：${thirdUnderTenth} 轮（${pct(thirdUnderTenth / Math.max(1, ratios.length))}）`)
console.log('')
console.log('分位数（第三名占第二名的比例）：')
for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
  const v = ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * q))] || 0
  console.log(`  ${pct(q)} 位：${pct(v)}`)
}
