/**
 * 纠错记账：他一个月纠正她几次
 * ============================
 *
 * 读审计日志里 k=correct-hint 的行，按天聚合。
 * 用途：被纠得多的日子，说明那阵子她记歪了；也能看"认了不改"有没有变少。
 *
 *   node scripts/correct-report.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const p = join(homedir(), '.dsh', 'consciousness-audit.log')
if (!existsSync(p)) { console.log('没有审计日志：' + p); process.exit(0) }

const byDay = new Map()
// 2026-11-21：日志不是空的、就是没有这一种——这两种情况长得完全不一样。
// 原来只报「还没有记录」，看的人会以为日志是空的。把种类数一并数出来。
const kinds = new Map()
let lines = 0
let total = 0
for (const line of readFileSync(p, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let r
  try { r = JSON.parse(line) } catch { continue }
  lines++
  kinds.set(r.k, (kinds.get(r.k) || 0) + 1)
  if (r.k !== 'correct-hint') continue
  total++
  const d = new Date(Number(r.t) || 0)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  byDay.set(key, (byDay.get(key) || 0) + 1)
}

console.log(`纠错触发次数：${total}`)
if (!total) {
  console.log(`这一种记糊了：审计日志里现有 ${lines} 条、${kinds.size} 种记录，唯独没有 correct-hint。`)
  console.log('要么他没纠错过，要么落这条记录的那段代码没跑到（改动要重启才生效，这条最常被忘）。')
  if (kinds.size) {
    const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    console.log('日志里最勤的几种：' + top.map(([k, v]) => k + ' ' + v).join('｜'))
  }
  process.exit(0)
}
const days = [...byDay.entries()].sort()
for (const [d, n] of days) console.log(`  ${d}  ${n} 次`)
console.log('')
console.log('说明：一次触发 = 她认定"他在纠错"。数多不代表她错得多，也可能是他那天话赶话。看趋势。')
