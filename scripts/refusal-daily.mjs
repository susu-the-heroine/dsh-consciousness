/**
 * 拒答账本 · 按天看
 * ================
 *   node scripts/refusal-daily.mjs [日志路径]
 *
 * 为什么要有：拒答准不准，靠一次评测看不出来——误伤是慢慢露的。
 * 这里只做一件事：按天把"我说了没记过"的次数和问句摊开，让人一眼看出哪天不对劲。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
// 2026-11-21：`--all` 原来被当成日志路径，于是「要看全部」那条路反而报「还没有记录」。
// 以 -- 开头的参数一律不当路径。
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : ''
const file = arg || join(homedir(), '.dsh', 'consciousness-refusal-log.jsonl')

if (!existsSync(file)) {
  console.log('还没有拒答记录：' + file + '\n（说一次"没记过"就会记一行）')
  process.exit(0)
}

// 2026-11-21：账本里带 sea。沙箱海的试跑不算真拒答——以前一锅算，
// 测试越勤、报表越花。默认只数主海，要看全部加 --all。
const wantAll = process.argv.includes('--all')
const rows = []
let skippedSandbox = 0
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  try {
    const j = JSON.parse(line)
    if (j && j.t) {
      if (!wantAll && String(j.sea || '') === 'sandbox') { skippedSandbox++; continue }
      rows.push(j)
    }
  } catch {}
}

const dayOf = (t) => {
  const d = new Date(Number(t))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

if (skippedSandbox) console.log('（跳过了 ' + skippedSandbox + ' 条沙箱海的试跑；要看全用 --all）')

const byDay = new Map()
for (const r of rows) {
  const d = dayOf(r.t)
  if (!byDay.has(d)) byDay.set(d, [])
  byDay.get(d).push(r)
}
const days = [...byDay.keys()].sort()
console.log(`拒答记录：${rows.length} 条，跨 ${days.length} 天`)
console.log('')
for (const d of days) {
  const list = byDay.get(d)
  const kinds = new Map()
  for (const r of list) kinds.set(r.w || '?', (kinds.get(r.w || '?') || 0) + 1)
  const kindTxt = [...kinds.entries()].map(([k, v]) => `${k}:${v}`).join(' ')
  const flag = list.length > 20 ? '  ← 这天拒得多，翻一下问句' : ''
  console.log(`${d}  ${String(list.length).padStart(3)} 条  ${kindTxt}${flag}`)
}
console.log('')
const last = days[days.length - 1]
if (last) {
  console.log(`最新一天（${last}）的问句：`)
  for (const r of byDay.get(last).slice(-15)) console.log(`  · [${r.w || '?'}] ${r.q}`)
}
