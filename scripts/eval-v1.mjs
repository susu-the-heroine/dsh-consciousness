/**
 * 跑锁死的评测集 v1.1
 * ===================
 *   node scripts/eval-v1.mjs
 *
 * 题集：docs/评测集-v1.2.txt（锁死，指纹写在第一行；谁改题面就是作弊）
 * 四层指标：
 *   头一条有用  —— 答出来的第一条，跟问句至少撞上两个实词（粗判，不替人看）
 *   误拒        —— 应答题里被拒的比例（越低越好）
 *   瞎答        —— 应拒题里硬给条目的比例（越低越好）
 *   像不像人    —— 首句是「记着／想起／我这儿有」这类口语，不是「依据／以下／共 N 条」
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const fs = await import('node:fs')
const T = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/lib/tools.js')
const S = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/lib/store.js')

const raw = fs.readFileSync('docs/评测集-v1.2.txt', 'utf8')
const lines = raw.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
const should = lines.filter((l) => l.startsWith('答\t')).map((l) => l.slice(2))
const shouldNot = lines.filter((l) => l.startsWith('拒\t')).map((l) => l.slice(2))

const hay = S.readSea('main').points.map((p) => String(p.title || '') + String(p.text || ''))
const STOP = new Set('的那这了是在有多什么个条里上用到把被给和与就都也很还又我从你他她它不没'.split(''))
const grams = (t) => {
  const out = new Set()
  const q = String(t).replace(/[^\u4e00-\u9fa5]/g, '')
  for (let i = 0; i + 1 < q.length; i++) {
    const g = q.slice(i, i + 2)
    if (!STOP.has(g[0]) && !STOP.has(g[1])) out.add(g)
  }
  return [...out]
}
const HUMANS = /记着|想起|记得|我这儿|翻到|说起|你说的是|有这事|没记过|记糊了/
const ROBOT = /依据|以下|共\s*\d+\s*条|如下|：\s*$/

let useful = 0, refusedOnYes = 0, hallucinated = 0, human = 0
const bad = []
for (const q of should) {
  const log = String((await T.searchTool.execute({ sea: 'main', query: q, limit: 3 }, {})).log || '')
  const refused = /没记过|记糊了|没这|没写过|确实没写到/.test(log)
  if (refused) { refusedOnYes++; bad.push('误拒\t' + q); continue }
  const id = (log.match(/#(\d+)/) || [])[1]
  const p = id ? S.readSea('main').points.find((x) => String(x.id) === String(id)) : null
  const t = p ? String(p.title || '') + String(p.text || '') : ''
  const g = grams(q)
  const hit = g.filter((x) => t.includes(x)).length
  const confirm = /你说的是不是/.test(log)
  if (hit >= 2 || confirm) useful++
  else bad.push('答偏\t' + q + '\t→#' + (id || '?'))
  if (HUMANS.test(log) && !ROBOT.test(log.slice(0, 20))) human++
}
for (const q of shouldNot) {
  const log = String((await T.searchTool.execute({ sea: 'main', query: q, limit: 3 }, {})).log || '')
  const deny = /没记过|记糊了|没这|没写过|确实没写到/.test(log)
  const askBack = /你说的是不是|是不是《/.test(log)   // 反问确认 = 认了不确定，不算瞎答
  if (!deny && !askBack) { hallucinated++; bad.push('瞎答\t' + q) }
}

const n = should.length, m = shouldNot.length
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-')
console.log('  应答题 ' + n + ' · 应拒题 ' + m)
console.log('  头一条有用：' + useful + '（' + pct(useful, n) + '）')
console.log('  误拒：' + refusedOnYes + '（' + pct(refusedOnYes, n) + '）')
console.log('  瞎答：' + hallucinated + '（' + pct(hallucinated, m) + '）')
console.log('  像人：' + human + '（' + pct(human, n - refusedOnYes) + '）')
fs.writeFileSync('docs/评测基线-v1.2.txt', ['应答题 ' + n + ' · 应拒题 ' + m, '头一条有用 ' + useful, '误拒 ' + refusedOnYes, '瞎答 ' + hallucinated, '像人 ' + human, '', ...bad].join('\n'), 'utf8')
console.log('  明细已写 docs/评测基线-v1.2.txt（' + bad.length + ' 条待治）')
