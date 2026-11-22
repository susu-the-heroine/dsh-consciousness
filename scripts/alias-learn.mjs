/**
 * 从真实对话里学别名（只出建议，不写库）
 * ======================================
 *
 * 想法（2026-11-14 他给的思路）：别名一直是我猜"他会怎么问"，
 * 但日志里有他真正的问法。把他真说过的话反写进别名，库就会自己长。
 *
 * 安全第一：这个脚本**只读日志 + 只写一份候选清单**，一个字都不改 data.json。
 *   - 候选要过他这一关（看清单点头）之后，才由别的动作写库
 *   - 只收"他下一句还在这条上"的（弱正义），孤证不收
 *
 * 跑法：node scripts/alias-learn.mjs [日志路径]
 * 输出：~/.dsh/consciousness-alias-candidates.md
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null
const logPath = arg || join(homedir(), '.dsh', 'consciousness-pick-log.jsonl')
const outPath = join(homedir(), '.dsh', 'consciousness-alias-candidates.md')

if (!existsSync(logPath)) { console.log('没有日志：' + logPath); process.exit(0) }

const rows = []
for (const l of readFileSync(logPath, 'utf8').split('\n')) {
  if (!l.trim()) continue
  try { rows.push(JSON.parse(l)) } catch {}
}
const sea = (rows[rows.length - 1] && rows[rows.length - 1].sea) || 'main'
const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const byId = new Map()
for (const p of data.points || []) byId.set(Number(p.id), p)

const grams = (s) => {
  const t = String(s || '').replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}
const ov = (a, b) => {
  const A = grams(a), B = grams(b)
  if (!A.size || !B.size) return 0
  let n = 0
  for (const g of A) if (B.has(g)) n++
  return n / A.size
}
const txtOf = (p) => String(p.title || '') + ' ' + String(p.alias || '') + ' ' + String(p.text || '').slice(0, 200)

const cands = []
for (let i = 0; i < rows.length - 1; i++) {
  const cur = rows[i], nxt = rows[i + 1]
  const q = String(cur.q || '').trim()
  const nextQ = String(nxt.q || '').trim()
  if (q.length < 4 || !q) continue          // 太短的不学（「cql」「嗯」学不出东西）
  if (/^\[SCHEDULE REMINDER/i.test(q)) continue   // 定时提醒不是他说的
  if (/^\[SCHEDULE REMINDER/i.test(nextQ)) continue
  if (nxt.q === cur.q) continue             // 同一句话重复，说明还没刷新，不算新证据
  if (nextQ.length < 4) continue
  const ids = [...(cur.core || []), ...(cur.rel || [])]
  if (!ids.length) continue
  let bestId = 0, best = 0
  for (const id of ids) {
    const p = byId.get(Number(id))
    if (!p) continue
    const v = ov(q, txtOf(p))
    if (v > best) { best = v; bestId = Number(id) }
  }
  if (!bestId || best < 0.15) continue      // 这句和这条根本不挨着，别学
  const keep = ov(nextQ, txtOf(byId.get(bestId))) >= 0.12   // 他下一句还在这条上
  if (!keep) continue
  const p = byId.get(bestId)
  if (String(p.alias || '').includes(q)) continue
  // 2026-11-14：第一条候选就是错的（"是不是一个超级大的表格" 配给了 "改之前先看有没有"），
  // 因为它只吃了「东西/是不是」这种虚词重叠。加两道闸：
  //   一、重叠要够高（0.30），二、这条有实体就必须真撞上实体。
  if (best < 0.3) continue
  const ents = Array.isArray(p.entities) ? p.entities : []
  if (ents.length) {
    const hitEnt = ents.some((e) => {
      const n = String(e || '').trim()
      return n.length >= 2 && q.includes(n)
    })
    if (!hitEnt) continue
  }
  // 2026-11-21：同一句问法会连着命中好几次（相邻两对都成立），清单里就出现两条一模一样的建议。
  // 认「哪条 + 哪句」这个组合去重。
  if (cands.some((c) => c.id === bestId && c.alias === q)) continue
  cands.push({ id: bestId, title: String(p.title || ''), alias: q, old: String(p.alias || ''), score: best })
}

// 负样本闸：以前判错的配对接二连三会回来，先按问句原文挡掉。
let negBlocked = 0
try {
  const negPath = join(HERE, 'data', 'alias-negatives.json')
  if (existsSync(negPath)) {
    const neg = JSON.parse(readFileSync(negPath, 'utf8'))
    const badQ = new Set((neg.cases || []).map((x) => String(x.q || '').trim()))
    for (let i = cands.length - 1; i >= 0; i--) {
      if (badQ.has(String(cands[i].alias || '').trim())) { cands.splice(i, 1); negBlocked++ }
    }
  }
} catch {}

const lines = []
lines.push('# 别名候选（只读产出，未写库）')
lines.push('')
lines.push(`来源：${logPath}`)
lines.push(`海：${sea} · 候选：${cands.length} 条`)
lines.push('')
lines.push('规矩：这些只是建议。你点头之前，一个字都不进库。')
lines.push('')
if (!cands.length) {
  lines.push('这次没学到东西——多半是日志里的问句还没刷新（旧问题重复出现），等 cql 之后再看。')
} else {
  for (const c of cands) {
    lines.push(`## #${c.id} ${c.title}`)
    lines.push(`- 建议别名：${c.alias}`)
    lines.push(`- 现有别名：${c.old || '（无）'}`)
    lines.push('')
  }
}
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`候选 ${cands.length} 条 → ${outPath}`)
for (const c of cands.slice(0, 10)) console.log(`  #${c.id} ${c.title} ← 「${c.alias}」`)
