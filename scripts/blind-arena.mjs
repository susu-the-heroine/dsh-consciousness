/**
 * 四选一盲测台：像人率的唯一主线口径
 * ==================================
 *   node scripts/blind-arena.mjs
 *
 * 每条题：1 条识海回答 + 3 条他的真实消息，打乱顺序、不标来源。
 * 评者（人或不知情的子智能体）挑出「最不像人」的一条。
 * 像人率 = 1 − 被挑中的识海回答比例。
 *
 * 现在这一步只负责「出题」：产出 docs/盲测-第1轮.md。
 * 评分由评者填：docs/盲测-第1轮-评分.md。
 * 反作弊：选项顺序按固定种子打乱；文件里不透露哪条是 AI——
 *        答案键单独写在 docs/盲测-第1轮-答案键.md，评完再看。
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const fs = await import('node:fs')
const path = await import('node:path')
const base = 'file:///' + process.cwd().replace(/\\/g, '/') + '/lib/'
const T = await import(base + 'tools.js')

const SEED = Number(process.env.EVAL_SEED || 20261122)
let _s = SEED >>> 0
const rnd = () => {
  _s = (_s + 0x6D2B79F5) >>> 0
  let t = _s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// 1) 他的真实消息：只取「短、像对话」的，避免粘贴长文
const rawDir = path.join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
const hisAll = []
const mineAll = []
if (fs.existsSync(rawDir)) {
  for (const f of fs.readdirSync(rawDir).filter((x) => x.endsWith('.jsonl'))) {
    for (const l of fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n').filter(Boolean)) {
      try {
        const o = JSON.parse(l)
        const t = String(o.text || '').trim()
        if (o.who !== 'memory') {
          if (t.length >= 8 && t.length <= 90 && !/https?:\/\//.test(t) && !/[`{}]/.test(t)) hisAll.push(t)
        } else {
          if (t.length >= 12 && t.length <= 160 && !/https?:\/\//.test(t) && !/[`{}#]/.test(t)) mineAll.push(t)
        }
      } catch {}
    }
  }
}

// 2) 「我」的候选：我过去真实发出去的话（raw 里 who=memory），不是工具日志
const N = 40
const answers = []
const poolA = mineAll.slice()
for (let i = poolA.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [poolA[i], poolA[j]] = [poolA[j], poolA[i]] }
for (const a of poolA) {
  if (answers.length >= N) break
  if (String(a).length < 12) continue
  answers.push({ q: '（无题面：纯语气对照）', a })
}

// 3) 组装四选一
const lines = ['# 盲测 第1轮（四选一：挑出最不像人的那条）', '', '共 ' + answers.length + ' 题。每题四条，只有一条是 AI 写的。挑完把编号写进评分文件。', '']
const key = ['# 答案键（评完再看）', '']
answers.forEach((it, i) => {
  const opts = [it.a]
  while (opts.length < 4) {
    const cand = hisAll[Math.floor(rnd() * hisAll.length)]
    if (cand && !opts.includes(cand)) opts.push(cand)
  }
  for (let j = opts.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [opts[j], opts[k]] = [opts[k], opts[j]] }
  const aiIdx = opts.indexOf(it.a)
  lines.push('## 第 ' + (i + 1) + ' 题', '', '问：' + it.q, '')
  opts.forEach((o, j) => lines.push('  ' + 'ABCD'[j] + '. ' + o.replace(/\n/g, ' ')))
  lines.push('')
  key.push('第 ' + (i + 1) + ' 题：' + 'ABCD'[aiIdx])
})
fs.writeFileSync('docs/盲测-第1轮.md', lines.join('\n') + '\n', 'utf8')
fs.writeFileSync('docs/盲测-第1轮-答案键.md', key.join('\n') + '\n', 'utf8')
console.log('  出题 ' + answers.length + ' 题 · 他的短句池 ' + hisAll.length + ' 条')
console.log('  题目：docs/盲测-第1轮.md · 答案键：docs/盲测-第1轮-答案键.md')
