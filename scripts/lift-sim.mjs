/**
 * 离线试"抬权重"：不碰库，只拿日志里当时的分数复算一遍
 * ====================================================
 *
 * 日志每行有一条 relScore：[id, 分, 重要度, 被想起次数]。
 * 按 inject.js 里同一个公式复算，看抬多少会让第一名换人。
 *
 *   node scripts/lift-sim.mjs            # 默认跑 0 / 0.15 / 0.3 / 0.5
 *   node scripts/lift-sim.mjs 0.2 0.4
 *
 * 复算公式与 inject 一致：分 × (1 + lift × (重要度×0.6 + min(1,次数/40)×0.4))
 * 注意：日志只存进了正文的头三条，所以这里只能看"这 trio 内部会不会换位"，
 * 看不了"第四名会不会顶上来"。要说全局结论，得等日志改成存全量。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LIFTS = process.argv.slice(2).map(Number).filter((x) => Number.isFinite(x) && x >= 0)
const lifts = LIFTS.length ? LIFTS : [0, 0.15, 0.3, 0.5]

const p = join(homedir(), '.dsh', 'consciousness-pick-log.jsonl')
if (!existsSync(p)) { console.log('没有日志：' + p); process.exit(0) }
const rows = []
for (const l of readFileSync(p, 'utf8').split('\n')) {
  if (!l.trim()) continue
  try {
    const r = JSON.parse(l)
    if (Array.isArray(r.relScore) && r.relScore.length >= 2 && Array.isArray(r.relScore[0])) rows.push(r)
  } catch {}
}

if (!rows.length) { console.log('日志里还没有带分的行——先说话，让它记几轮。'); process.exit(0) }

const rank = (arr, lift) => arr
  .map((x) => {
    const [id, score, imp, rc] = x
    const w = 1 + lift * (Number(imp || 0) * 0.6 + Math.min(1, Number(rc || 0) / 40) * 0.4)
    return { id, score, imp, rc, v: Number(score) * w }
  })
  .sort((a, b) => b.v - a.v)

console.log(`带分行 ${rows.length} 条`)
for (const lift of lifts) {
  let changed = 0
  const ex = []
  for (const r of rows) {
    const before = rank(r.relScore, 0)[0].id
    const after = rank(r.relScore, lift)[0].id
    if (before !== after) { changed++; if (ex.length < 3) ex.push({ q: r.q, before, after }) }
  }
  console.log(`\nlift=${lift} · 头名变了 ${changed}/${rows.length}（${((changed / rows.length) * 100).toFixed(0)}%）`)
  for (const e of ex) console.log(`   「${String(e.q || '').slice(0, 24)}」 #${e.before} → #${e.after}`)
}
console.log('\n说明：只在候选之间比，看不到候选外的人。样本 <200 行之前，这个数只能当日志看。')

// 顺手看"分有多陡"：第一名几分、够不够两条、尾巴几条只撞了一个二字片段
console.log('\n分形（看噪声有多少）')
let thin = 0
// 2026-11-21：原来每一行都打，实测一千四百九十三条带分行 → 两千五百多行输出，
// 真要找那十条「只有一条够分」的，得在屏幕上翻半天。改成只列前 15 条，其余只报数。
const SHOW = 15
let shown = 0
for (const r of rows) {
  const s = r.relScore.map((x) => Number(x[1]) || 0).sort((a, b) => b - a)
  const real = s.filter((v) => v >= 2).length
  if (real <= 1) thin++
  if (shown < SHOW) {
    console.log(`  「${String(r.q || '').slice(0, 18)}」 前四：${s.slice(0, 4).join(' / ')} · ≥2分的 ${real} 条`)
    shown++
  }
}
if (rows.length > SHOW) console.log(`  ……其余 ${rows.length - SHOW} 条不列了（要看全，把 SHOW 调大）`)
console.log(`\n只有一条够 2 分的轮次：${thin}/${rows.length}`)
