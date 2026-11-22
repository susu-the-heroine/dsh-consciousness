/**
 * 文风分布对照（占位版）
 * ======================
 *   node scripts/style-baseline.mjs
 *
 * 说明（必须照实说）：
 *   公开中文多人对话语料在当前离线环境取不到（GitHub / HF 都超时）。
 *   所以这一版只能拿「他的原始消息」当参照——那不是人类基线，只是一个人的分布。
 *   等能取到公开语料，再把这一列换掉。文件名带 v0 就是提醒这一点。
 *
 * 量六项：平均句长、句长标准差、逗号密度、问号率、感叹号率、半句率（结尾没标点）。
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const fs = await import('node:fs')
const path = await import('node:path')
const base = 'file:///' + process.cwd().replace(/\\/g, '/') + '/lib/'
const T = await import(base + 'tools.js')
const S = await import(base + 'store.js')

const stat = (arr) => {
  const n = arr.length
  const mean = arr.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  return { n, mean, sd }
}
const metrics = (texts) => {
  const lens = [], commas = [], q = [], ex = [], half = []
  for (const t of texts) {
    const s = String(t).trim()
    if (!s) continue
    lens.push(s.length)
    commas.push((s.match(/[，,]/g) || []).length / Math.max(1, s.length / 20))
    q.push(/[？?]/.test(s) ? 1 : 0)
    ex.push(/[！!]/.test(s) ? 1 : 0)
    half.push(/[。！？!?…~～]$/.test(s) ? 0 : 1)
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
  const L = stat(lens)
  const sorted = lens.slice().sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)] || 0
  const p10 = sorted[Math.floor(sorted.length * 0.1)] || 0
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0
  return {
    n: L.n,
    len: L.mean.toFixed(1),
    med: String(med),
    p10: String(p10),
    p90: String(p90),
    sd: L.sd.toFixed(1),
    comma: avg(commas).toFixed(2),
    q: (avg(q) * 100).toFixed(1) + '%',
    ex: (avg(ex) * 100).toFixed(1) + '%',
    half: (avg(half) * 100).toFixed(1) + '%',
  }
}

// A. 他的原始消息（只当他一个人的参照，不是人类基线）
const rawDir = path.join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
const his = []
if (fs.existsSync(rawDir)) {
  for (const f of fs.readdirSync(rawDir).filter((x) => x.endsWith('.jsonl'))) {
    const lines = fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n').filter(Boolean)
    for (const l of lines) {
      try {
        const o = JSON.parse(l)
        if (o.text && String(o.who || '') !== 'memory') his.push(String(o.text))
      } catch {}
    }
  }
}
const hisSample = his.slice(-3000)

// B. 识海的回答：拿评测集里的 40 个问题跑一遍
const qs = fs.readFileSync('docs/评测集-v1.2.txt', 'utf8').split('\n')
  .filter((l) => l.startsWith('答\t')).map((l) => l.slice(2)).slice(0, 40)
const mine = []
for (const q of qs) {
  const log = String((await T.searchTool.execute({ sea: 'main', query: q, limit: 3 }, {})).log || '')
  if (log) mine.push(log)
}

const A = metrics(hisSample)
const B = metrics(mine)
const out = [
  '文风分布对照 v0（占位：参照是「他一个人」，不是人类基线）',
  '',
  '项目        他的消息        识海回答',
  '样本数      ' + A.n + '            ' + B.n,
  '平均句长    ' + A.len + '          ' + B.len,
  '中位句长    ' + A.med + '          ' + B.med,
  'P10/P90     ' + A.p10 + '/' + A.p90 + '      ' + B.p10 + '/' + B.p90,
  '句长标准差  ' + A.sd + '          ' + B.sd,
  '逗号密度    ' + A.comma + '          ' + B.comma,
  '问号率      ' + A.q + '          ' + B.q,
  '感叹号率    ' + A.ex + '          ' + B.ex,
  '半句率      ' + A.half + '          ' + B.half,
  '',
  '说明：他的原始消息共 ' + his.length + ' 条，这里取最近 3000 条；识海取了 ' + mine.length + ' 条回答。',
]
fs.writeFileSync('docs/风格基线-v0.md', out.join('\n') + '\n', 'utf8')
console.log(out.slice(2, 9).join('\n  '))
console.log('  明细：docs/风格基线-v0.md')
