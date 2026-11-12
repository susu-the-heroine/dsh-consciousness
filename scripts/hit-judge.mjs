/**
 * 命中率·复核口径（2026-11-08 定）
 *
 * 为什么不用关键词：实测同一批对话，关键词撞出 3%，复核者判出 39%——
 * 她用了记忆也不必说原词，关键词口径会把它算成没命中。差 36 个点，不能当结论。
 *
 * 流程：
 *   1) 四个假用户各六轮，走 /consciousness/sim，把自己和她的话写进
 *      ~/.dsh/consciousness-replay.jsonl（字段 sid/turn/him/her/inj）
 *   2) 四个复核者，各判自己那条线的六轮，写进
 *      ~/.dsh/consciousness-verdict.jsonl（字段 sid/turn/used/which/why）
 *   3) 跑这个脚本，出「用上率」和「日志口径」两个数，一起报。
 *
 * 用法：node scripts/hit-judge.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const D = join(homedir(), '.dsh')
const REPLAY = join(D, 'consciousness-replay.jsonl')
const VERDICT = join(D, 'consciousness-verdict.jsonl')
const LOG = join(D, 'consciousness-inject.log')

function load(p) {
  if (!existsSync(p)) return []
  const out = []
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.replace(/^\uFEFF/, '').trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch {}
  }
  return out
}

const replay = load(REPLAY)
const verdict = load(VERDICT)
const log = load(LOG)

if (!verdict.length) {
  console.log('还没有复核结果。先跑一轮：四个假用户 + 四个复核。')
  process.exit(0)
}

const used = verdict.filter((v) => v && v.used === true)
const rate = used.length / verdict.length * 100

console.log(`复核口径：${used.length}/${verdict.length} = ${rate.toFixed(1)}%`)
console.log(`（判定来自 ${new Set(verdict.map((v) => v.sid)).size} 条线，回放 ${replay.length} 轮）`)

// 同一个 sid 上的日志口径，作对照
for (const sid of [...new Set(verdict.map((v) => v.sid))]) {
  const mine = verdict.filter((v) => v.sid === sid)
  const u = mine.filter((v) => v.used === true).length
  const lr = log.filter((r) => r.sid === sid && r.prevN)
  const lh = lr.filter((r) => (r.prevHit || []).length > 0).length
  console.log(`  ${sid}：复核 ${u}/${mine.length}｜日志 ${lh}/${lr.length}`)
}

const total = log.filter((r) => r.prevN && /^r\d+$/.test(String(r.sid || '')))
if (total.length) {
  const lh = total.filter((r) => (r.prevHit || []).length > 0).length
  console.log(`\n同一批对话的日志口径：${lh}/${total.length} = ${(lh / total.length * 100).toFixed(1)}%`)
  console.log(`差 ${(rate - lh / total.length * 100).toFixed(1)} 个点——这就是关键词口径低估的量。`)
}
console.log('\n报数规矩：两个都报，不许只报好看的那个。')
