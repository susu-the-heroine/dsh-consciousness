/**
 * 命中率：注入的那些记忆，下一句里他到底说没说到。
 *
 * 口径说清楚（别自己骗自己）：
 *   松 —— 下一条消息里出现这条记忆的任意一个两字指纹
 *   严 —— 出现两个以上
 *   这测的是"他下一句提到了"，不是"我回复里用上了"。两件事，别混。
 *
 * 只算真实对话：排除 sim / visitor / scene_* 那些测试打出来的。
 *
 * 用法：node scripts/hit-rate.mjs [--all]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const LOG = join(homedir(), '.dsh', 'consciousness-inject.log')
if (!existsSync(LOG)) {
  console.log('还没有日志。跑几轮真对话再看。')
  process.exit(0)
}

const TEST_SID = /^(sim|scene_|visit|test|hit\d*$|q\d+)/
const rows = []
for (const line of readFileSync(LOG, 'utf8').split('\n')) {
  if (!line.trim()) continue
  // 追加时可能带 BOM（PowerShell 的 Add-Content 会），先剥掉
  try { rows.push(JSON.parse(line.replace(/^\uFEFF/, ''))) } catch {}
}
const real = rows.filter((r) => !TEST_SID.test(String(r.sid || '')))
const use = process.argv.includes('--all') ? rows : real

// 只统计"上一轮有注入、且本轮确实来了新消息"的那些轮次
const judged = use.filter((r) => r.prevN !== null && r.prevN > 0 && Array.isArray(r.prevHit))
let loose = 0, strict = 0, inj = 0, hitItems = 0
for (const r of judged) {
  inj += Number(r.prevN) || 0
  if (r.prevHit.length > 0) loose++
  if (Array.isArray(r.prevHit2) && r.prevHit2.length > 0) strict++
  hitItems += r.prevHit.length
}

console.log(`日志 ${rows.length} 轮（真实 ${real.length}）`)
console.log(`能判的轮次：${judged.length}`)
if (judged.length) {
  console.log(`松口径：${loose}/${judged.length} = ${(loose / judged.length * 100).toFixed(1)}%`)
  console.log(`严口径：${strict}/${judged.length} = ${(strict / judged.length * 100).toFixed(1)}%`)
  console.log(`平均每轮塞 ${(inj / judged.length).toFixed(1)} 条，被下一句提到 ${(hitItems / judged.length).toFixed(1)} 条`)
}
console.log('\n口径提醒：这是"他下一句说到没"，不是"我回复用上没"。')

// 哪几条从没被提到过
const seen = new Map()
for (const r of judged) {
  for (const x of (r.rows || [])) if (x && x.id != null) seen.set(x.id, (seen.get(x.id) || 0) + 1)
}
const never = [...seen.entries()].filter(([id]) => !judged.some((r) => (r.prevHit || []).includes(id)))
if (never.length) {
  console.log(`\n塞进去过、但从没被下一句提到的：${never.length} 条`)
  console.log('  ' + never.slice(0, 12).map(([id, n]) => `#${id}(${n}次)`).join(' '))
}
