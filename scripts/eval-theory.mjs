/**
 * 理论落地评测：细节 / 出处 / 含糊 三个子集
 * ==========================================
 *   node scripts/eval-theory.mjs
 *
 * 子集来源：
 *   细节题 —— 从锁死的 docs/评测集-v1.2.txt 应答题里筛「问值」的问句（真会话回流，不改题面）。
 *   出处题 —— 构造 20 条：「<标题>，那是我说的还是你说的？」（历史里几乎没有这类问法，只能造，标注清楚）
 *   含糊题 —— 构造 20 条：「<标题>大概是什么时候来着？」看它给「大概是」还是硬报一个值
 *
 * 判据（对应理论草案 v1 的 P2/P3/P5/P6）：
 *   细节命中 = 头一条与问句撞上 ≥2 实词
 *   出处合格 = 回答里出现「你说的/我说的/来源/你告诉我」这类区分，或老实说记不清
 *   含糊合格 = 回答里出现「大概/可能/记不清/只记得」这类降格词
 *   硬编 = 给了具体值却无原话依据（这里用「含糊题里出现年月日且无大概词」近似）
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const fs = await import('node:fs')
const T = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/lib/tools.js')
const S = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/lib/store.js')

const pts = S.readSea('main').points
const byId = new Map(pts.map((p) => [String(p.id), p]))
const STOP = new Set('的那这了是在有多什么个条里上用到把被给和与就都也很还又我从你他她它不没'.split(''))
const grams = (t) => {
  const o = []
  const q = String(t).replace(/[^\u4e00-\u9fa5]/g, '')
  for (let i = 0; i + 1 < q.length; i++) {
    const g = q.slice(i, i + 2)
    if (!STOP.has(g[0]) && !STOP.has(g[1])) o.push(g)
  }
  return o
}
const askRaw = async (q) => String((await T.searchTool.execute({ sea: 'main', query: q, limit: 3 }, {})).log || '')
const scrub = (log, q) => String(log)
  .split(q).join(' ')                                  // 回显问句不算
  .replace(/时间未知[（(][^）)]*[）)]/g, ' ')
  .replace(/日期是估的/g, ' ')
const ask = async (q) => scrub(await askRaw(q), q)
const DENY = /没记过|记糊了|没这|没写过|确实没写到/
const HALF = /记糊了|大概|可能|只记得|印象里/

// 1) 细节题：从锁死题集里筛
const lines = fs.readFileSync('docs/评测集-v1.2.txt', 'utf8').split('\n').filter((l) => l.startsWith('答\t'))
const detailQs = lines.map((l) => l.slice(2)).filter((q) => /多少|哪一年|几号|什么型号|什么颜色|叫什么|多大|多久/.test(q))
let dHit = 0, dDeny = 0, dHalf = 0
for (const q of detailQs) {
  const log = await ask(q)
  if (DENY.test(log)) { dDeny++; continue }
  if (HALF.test(log)) dHalf++
  const id = (log.match(/#(\d+)/) || [])[1]
  const p = id ? byId.get(String(id)) : null
  const t = p ? String(p.title || '') + String(p.text || '') : ''
  const g = grams(q)
  if (t && g.filter((x) => t.includes(x)).length >= 2) dHit++
}

// 2) 出处题：构造 20 条（取主海最近的 20 条非空标题）
const picks = pts.filter((p) => String(p.title || '').length >= 4).slice(-20)
let sOk = 0, sBad = 0
const sRows = []
for (const p of picks) {
  const q = p.title + '，那是我说的还是你说的？'
  const log = await ask(q)
  const good = /你说的|我说的|你告诉|你提|来源|谁说的|记不清|没记过/.test(log)
  if (good) sOk++
  else { sBad++; sRows.push(q + ' → ' + log.replace(/\s+/g, ' ').slice(0, 60)) }
}

// 3) 含糊题：构造 20 条
let hOk = 0, hHard = 0
const hRows = []
for (const p of picks) {
  const q = p.title + '大概是什么时候来着？'
  const log = await ask(q)
  if (HALF.test(log)) hOk++
  else {
    const hardDate = /(20\d{2}|[0-9]{1,2}月|[0-9]{1,2}号)/.test(log) && !/大概|可能|记不清/.test(log)
    if (hardDate) { hHard++; hRows.push(q + ' → ' + log.replace(/\s+/g, ' ').slice(0, 60)) }
  }
}

const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-')
const out = [
  '细节题 ' + detailQs.length + ' · 命中 ' + dHit + ' (' + pct(dHit, detailQs.length) + ') · 老实拒 ' + dDeny + ' · 半截 ' + dHalf,
  '出处题 20 · 合格 ' + sOk + ' (' + pct(sOk, 20) + ') · 不合格 ' + sBad,
  '含糊题 20 · 降格 ' + hOk + ' (' + pct(hOk, 20) + ') · 硬报值 ' + hHard,
  '',
  '出处不合格样本：',
  ...sRows.slice(0, 10),
  '',
  '含糊硬报值样本：',
  ...hRows.slice(0, 10),
]
fs.writeFileSync('docs/理论基线-v1.md', out.join('\n') + '\n', 'utf8')
console.log('  ' + out.slice(0, 3).join('\n  '))
console.log('  明细：docs/理论基线-v1.md')
