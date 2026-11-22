/**
 * 记账配对：把"这一轮给了她哪几条"和"他下一句说了什么"配成对
 * ==========================================================
 *
 * 为什么不用题库：人的意思没法穷举（2026-11-14 他说的）。
 * 这里只用弱信号，不做真理判断：
 *   - 他下一句和某条注入记忆的字面有重叠 → 记为「接住」
 *   - 他下一句带否定词（不对/不是/错了/没有） → 记为「否掉」
 *   - 什么都没提 → 记为「没接」——不等于拒绝，只是没聊到
 *
 * 跑法：node scripts/pick-report.mjs [日志路径] [--show]
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null
const logPath = arg || join(homedir(), '.dsh', 'consciousness-pick-log.jsonl')
const show = process.argv.includes('--show')

if (!existsSync(logPath)) {
  console.log('还没有日志：' + logPath)
  process.exit(0)
}

const lines = readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim())
const rows = []
for (const l of lines) {
  try { rows.push(JSON.parse(l)) } catch {}
}
if (rows.length < 2) {
  console.log(`日志 ${rows.length} 行，还不够配对（至少 2 行）。`)
  process.exit(0)
}

// 记忆库：id → 用来比对的文字
const sea = rows[rows.length - 1].sea || 'main'
let byId = new Map()
try {
  const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
  for (const p of data.points || []) {
    byId.set(Number(p.id), String(p.title || '') + ' ' + String(p.alias || '') + ' ' + String(p.text || '').slice(0, 120))
  }
} catch {}

// 2026-11-21：原来单放一个「别」字。他一句「别人也这么说」就被判成「否掉」——
// 「别」在中文里最常见的是「别人、别的、别处」，不是否定这条记忆。改成只认真正的否定说法。
const NEG = ['不对', '不是', '错了', '记错', '没有', '不记得', '别再', '别乱', '别瞎编']
const grams = (s) => {
  const t = String(s || '').replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}
const overlap = (a, b) => {
  const A = grams(a), B = grams(b)
  if (!A.size || !B.size) return 0
  let n = 0
  for (const g of A) if (B.has(g)) n++
  return n / A.size
}

let paired = 0, caught = 0, negated = 0, silent = 0, tooShort = 0, dupSkip = 0, reminderSkip = 0
const samples = []
for (let i = 0; i < rows.length - 1; i++) {
  const cur = rows[i], nxt = rows[i + 1]
  const nextQ = String(nxt.q || '').trim()
  if (!nextQ) continue
  const ids = [...(cur.core || []), ...(cur.rel || [])]
  if (!ids.length) continue
  // 太短的不判：「cql」「嗯」「继续」这种，两个字全重叠就 1.00，
  // 会把弱信号虚抬到满分。2026-11-14 第一次跑就看见这个假高。
  // 定时提醒不是他说的话，别算进分母（2026-11-14 实测被它污染了两对）
  if (/^\[SCHEDULE REMINDER/i.test(nextQ) || /SCHEDULE REMINDER BATCH/i.test(nextQ)) { reminderSkip++; continue }
  if (nextQ.length < 4) { tooShort++; continue }
  // 同一句被记了两三行（text() 一轮调多次），那不是两轮，跳过
  if (nextQ === String(cur.q || '').trim()) { dupSkip++; continue }
  paired++
  let best = 0, bestId = 0
  for (const id of ids) {
    const txt = byId.get(Number(id)) || ''
    const ov = overlap(nextQ, txt)
    if (ov > best) { best = ov; bestId = id }
  }
  const isNeg = NEG.some((w) => nextQ.includes(w))
  let verdict = '没接'
  if (isNeg && best >= 0.12) { verdict = '否掉'; negated++ }
  else if (best >= 0.2) { verdict = '接住'; caught++ }
  else silent++
  // 新日志带了分（relScore），有就一起看：命中的那条当时排第几、差多少
  let hitScore = null
  if (Array.isArray(cur.relScore)) {
    const h = cur.relScore.find((x) => Array.isArray(x) && Number(x[0]) === Number(bestId))
    if (h) hitScore = Number(h[1])
  }
  if (show) samples.push({ q: cur.q, next: nextQ.slice(0, 40), ids: ids.join(','), best: best.toFixed(2), bestId, verdict, hitScore })
}

console.log(`日志 ${rows.length} 行 · 可配对 ${paired} 对 · 海 ${sea}`)
console.log(`（太短跳过 ${tooShort} · 同句重复跳过 ${dupSkip} · 定时提醒跳过 ${reminderSkip}）`)
if (!paired) process.exit(0)
console.log(`接住 ${caught} · 否掉 ${negated} · 没接 ${silent}`)
console.log(`接住率（弱信号）${((caught / paired) * 100).toFixed(0)}%`)
console.log('')
console.log('说明：没接 ≠ 拒绝，只是他下一句没聊到这条。样本 <200 对之前只看趋势，别当结论。')
if (show) {
  console.log('')
  for (const s of samples.slice(-15)) {
    console.log(`  [${s.verdict}] ${s.q} → 他:${s.next} · 命中#${s.bestId}(${s.best})`
      + (s.hitScore != null ? ` · 当时该条分 ${s.hitScore}` : ''))
  }
}
