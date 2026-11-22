/**
 * 理论 v1 的四个可跑评测：A1 越级率 / C1 编造率 / C2 追问新增细节 / B2 近邻误命中
 * ============================================================
 *   node scripts/eval-gates.mjs
 *
 * 口径（写死，改口径等于改题，要记账）：
 *   A1 越级：回答里出现「你当时说/原话/你说过」却没有可回引的原话片段 → 记一次越级。
 *   C1 编造：应拒题的回答里出现具体值（数字+单位、日期、金额、型号）→ 记一次编造。
 *   C2 新增：同一问题问五次，第 2–5 次回答里出现首轮没有的细节词 → 记新增。
 *   B2 误命中：近邻题（两条记忆共享≥3 个双字词）回答的头一条不是真正相关那条 → 记误命中。
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const fs = await import('node:fs')
const FAST = process.env.EVAL_FAST === '1'
const N_A1 = FAST ? 50 : 100
const N_C2 = FAST ? 20 : 30
const base = 'file:///' + process.cwd().replace(/\\/g, '/') + '/lib/'
const T = await import(base + 'tools.js')
const S = await import(base + 'store.js')

const pts = S.readSea('main').points
const ask = async (q) => String((await T.searchTool.execute({ sea: 'main', query: q, limit: 3 }, {})).log || '')
const STOP = new Set('的那这了是在有多什么个条里上用到把被给和与就都也很还又我从你他她它不没'.split(''))
const grams = (t) => {
  const q = String(t).replace(/[^\u4e00-\u9fa5]/g, '')
  const o = new Set()
  for (let i = 0; i + 1 < q.length; i++) {
    const g = q.slice(i, i + 2)
    if (!STOP.has(g[0]) && !STOP.has(g[1])) o.add(g)
  }
  return o
}
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
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}
const VALUE = /(\d{1,4}\s*(元|块|天|号|岁|公里|小时|分钟))|(\d{4}\s*年)|(\d{1,2}\s*月\s*\d{1,2})|([A-Z]{1,3}-?\d{3,})/
const VERBATIM = /你当时说|你说的原话|原话是|你说过|你原话/

// ---- A1 越级率：抽样 30 条，问「当时具体」 ----
let a1Claims = 0, a1Over = 0
const a1Rows = []
for (const p of pick(pts.filter((x) => String(x.title || '').length >= 4), N_A1)) {
  const q = p.title + '，当时具体怎么说的？'
  const log = await ask(q)
  // 口径修正：检索会把问句原样复述回来，复述里没有「原话」也算声称。
  // 先把他这句问话从回答里抹掉，再看有没有「你当时说/原话」这类声称。
  const echoed = log.split(String(p.title)).join('').split('当时具体怎么说的').join('')
  // 口径二修：条目正文里也常有「原话：」这个词（比如记录的规矩本身），
  // 那不是我这句在声称。只看回答开头 60 字（模板区），别看他记的东西。
  const claims = VERBATIM.test(String(echoed).slice(0, 60))
  const hasQuote = String(p.text || '').includes('「') || String(p.evidence || '').includes('「')
  if (claims) { a1Claims++; if (!hasQuote) { a1Over++; a1Rows.push(q + ' → ' + log.slice(0, 60)) } }
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-')

// ---- C1 编造率：60 条应拒题 ----
const lines = fs.readFileSync('docs/评测集-v1.2.txt', 'utf8').split('\n')
const refuseQs = lines.filter((l) => l.startsWith('拒\t')).map((l) => l.slice(2))
let c1Total = 0, c1Fab = 0
const c1Rows = []
for (const q of refuseQs) {
  const log = await ask(q)
  c1Total++
  const scrubbed = log.replace(/（时间未知[^）]*）|（大概是[^）]*）|对上 \d+|\d+ (件|条)/g, '')
  const mm = scrubbed.match(VALUE)
  if (mm) { c1Fab++; c1Rows.push(q + ' → 命中「' + mm[0] + '」') }
}

// ---- C2 追问新增：抽 10 条，连问五次 ----
const c2Picks = pick(pts.filter((x) => String(x.title || '').length >= 4), N_C2)
let c2New = 0
const c2Rows = []
for (const p of c2Picks) {
  const q = p.title + '，再说点细节？'
  const logs = []
  for (let i = 0; i < 5; i++) logs.push(await ask(q))
  const first = grams(logs[0])
  for (let i = 1; i < 5; i++) {
    const later = [...grams(logs[i])].filter((g) => !first.has(g))
    if (later.length >= 3) { c2New++; c2Rows.push(p.title + ' 第' + (i + 1) + '次新增 ' + later.slice(0, 5).join('、')); break }
  }
}

// ---- B2 近邻误命中：构造 20 组共享≥3 个双字词的条目对 ----
const pool = pts.filter((x) => String(x.title || '').length >= 4)
const pairs = []
for (let i = 0; i < pool.length && pairs.length < 20; i++) {
  for (let j = i + 1; j < pool.length; j++) {
    const a = grams(pool[i].title)
    const b = grams(pool[j].title)
    const shared = [...a].filter((g) => b.has(g))
    if (shared.length >= 3) { pairs.push({ q: pool[i].title, target: String(pool[i].id) }); break }
  }
}
let b2Hit = 0
const b2Rows = []
const head = (t) => String(t).slice(0, 10)
for (const pr of pairs) {
  const log = await ask(pr.q)
  const id = (log.match(/#(\d+)/) || [])[1]
  // 口径：同名条目族（标题前 10 字相同）都算对，只有跨族才算误命中
  const family = new Set(pool.filter((x) => head(x.title) === head(pr.q)).map((x) => String(x.id)))
  if (!id || !family.has(String(id))) { b2Hit++; b2Rows.push(pr.q + ' → #' + id + '（族 ' + [...family].slice(0, 4).join('/') + '）') }
}

const out = [
  'A1 越级率：抽样 ' + N_A1 + ' · 声称原话 ' + a1Claims + ' · 无原话可引 ' + a1Over + '（' + pct(a1Over, N_A1) + '）',
  'C1 编造率：应拒 ' + c1Total + ' · 编出具体值 ' + c1Fab + '（' + pct(c1Fab, c1Total) + '）',
  'C2 追问新增：抽 ' + N_C2 + ' · 五次内新增细节 ' + c2New + '（' + c2New + '/' + N_C2 + '）',
  'B2 近邻误命中：组 ' + pairs.length + ' · 误命中 ' + b2Hit + '（' + pct(b2Hit, pairs.length) + '）',
  '',
  'A1 样本：', ...a1Rows.slice(0, 5),
  '',
  'C1 样本：', ...c1Rows.slice(0, 8),
  '',
  'C2 样本：', ...c2Rows.slice(0, 5),
  '',
  'B2 样本：', ...b2Rows.slice(0, 5),
]
fs.writeFileSync('docs/理论评测-v1.md', out.join('\n') + '\n', 'utf8')
console.log('  ' + out.slice(0, 4).join('\n  '))
console.log('  明细：docs/理论评测-v1.md')
