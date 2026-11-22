/**
 * 长程接续测试（用历史条目当“上一轮”，不花他时间）
 * ==================================================
 *   node scripts/replay-longrange.mjs
 *
 * 做两轮：第一轮问某事 → 第二轮只问「刚才那个，再补充点细节」，
 * 看第二轮是否还落在同一条（或同族）上。这就是「记不记得上一轮」的最低可测版本。
 *
 * 口径：
 *   接续成功 = 第二轮回答的头一条 id 与第一轮相同，或属于同标题族（前 10 字）。
 *   接续失败 = 换了别的条目，或者答成「没记过」。
 *   种子固定，可复现。
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const fs = await import('node:fs')
const base = 'file:///' + process.cwd().replace(/\\/g, '/') + '/lib/'
const T = await import(base + 'tools.js')
const S = await import(base + 'store.js')

const SEED = Number(process.env.EVAL_SEED || 20261122)
let _s = SEED >>> 0
const rnd = () => {
  _s = (_s + 0x6D2B79F5) >>> 0
  let t = _s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr, n) => {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a.slice(0, n)
}
const pts = S.readSea('main').points
const pool = pts.filter((p) => String(p.title || '').length >= 6)
const ask = async (q) => String((await T.searchTool.execute({ sea: 'main', query: q, limit: 3 }, {})).log || '')
const head = (t) => String(t).slice(0, 10)
const idOf = (log) => (log.match(/#(\d+)/) || [])[1]

let ok = 0, bad = 0, empty = 0
const rows = []
for (const p of pick(pool, 30)) {
  const q1 = p.title + '？'
  const l1 = await ask(q1)
  const id1 = idOf(l1)
  if (!id1) { empty++; continue }
  const q2 = '刚才说的那个，再补充点细节'
  const l2 = await ask(q2)
  const id2 = idOf(l2)
  const family = new Set(pool.filter((x) => head(x.title) === head(p.title)).map((x) => String(x.id)))
  if (id2 && (String(id2) === String(id1) || family.has(String(id2)))) ok++
  else { bad++; rows.push('「' + head(p.title) + '」首轮 #' + id1 + ' → 追问 ' + (id2 ? '#' + id2 : '无')) }
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-')
const out = [
  '长程接续：样本 30 · 接上 ' + ok + '（' + pct(ok, 30) + '）· 掉线 ' + bad + ' · 首轮无命中 ' + empty,
  '',
  '掉线样本：', ...rows.slice(0, 8),
]
fs.writeFileSync('docs/长程接续-v1.md', out.join('\n') + '\n', 'utf8')
console.log('  ' + out[0])
console.log('  明细：docs/长程接续-v1.md')
