/**
 * 用真工具量，别用量不了的影子
 * ============================
 *
 *   node scripts/eval-tool.mjs
 *   C2_REL_NEIGHBOR=1 C2_REL_W=0.85 node scripts/eval-tool.mjs
 *
 * 为什么另写一个：eval-sweep 走的是它自己那套打分，不经过 searchTool，
 * 所以改检索工具它看不见——2026-11-15 凌晨拿它比"扩层开/关"，
 * 两组数一模一样，白比了半小时。
 *
 * 这个直接调 memory_search 的实现，数"目标进没进前三"。
 * 只读。用 temp HOME 就能量沙箱海里的副本。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())

const HS = JSON.parse(readFileSync(join(HERE, 'data', 'recall-holdout.json'), 'utf8')).cases
const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'

const rankOf = (log, want) => {
  const ids = [...String(log || '').matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
  const i = ids.indexOf(want)
  return i < 0 ? Infinity : i + 1
}

let top3 = 0, top1 = 0, miss = 0
const rows = []
for (const c of HS) {
  const r = await T.searchTool.execute({ sea, query: c.q })
  const log = String((r && (r.log || r.text)) || '')
  const rk = rankOf(log, c.want)
  if (rk === 1) top1++
  if (rk <= 3) top3++
  if (!Number.isFinite(rk)) miss++
  rows.push({ q: c.q, want: c.want, rank: rk })
}

for (const x of rows.filter((r) => r.rank > 3)) {
  console.log(`  没进前三：want #${x.want} rank=${x.rank === Infinity ? '没出现' : x.rank} ← ${x.q}`)
}
console.log(`工具口径：${HS.length} 题，前三 ${top3}/${HS.length}，头名 ${top1}，完全没出现 ${miss}（扩层=${process.env.C2_REL_NEIGHBOR === '0' ? '关' : '开'} 权重=${process.env.C2_REL_W || '0.45'}）`)

// 没记过的六件事：不要求它答得多准，只记它有几条会硬塞卡片
const NEG = [
  '他养的那只蜥蜴叫什么', '他去年去冰岛住的哪家酒店', '他外婆家的门牌号',
  '他那把吉他是哪年买的', '他第一次潜水是在哪片海', '他办公室的绿萝谁送的',
]
let refuseN = 0
for (const q of NEG) {
  const r = await T.searchTool.execute({ sea, query: q })
  if (/没记过/.test(String((r && r.log) || ''))) refuseN++
}
console.log(`没记过的六件：说没有 ${refuseN}/6（其余是递了卡片）`)
