/**
 * 盲测 · 短句版（口径：只比同长度段，排除「长」这个混淆项）
 * ========================================================
 *   node scripts/blind-short.mjs
 *
 * 为什么加这一版：上一版四选一，我的候选都是 120 字以上的长回复，
 * 评者一律挑「太长」，等于只测了长度。这一版把两边都卡在
 * 12–60 字，长度拉平，剩下的差别才是语气、用词、结构。
 *
 * 出题 → docs/盲测-短句.md；答案键 → docs/盲测-短句-答案键.md
 */
const fs = await import('node:fs')
const path = await import('node:path')

const SEED = Number(process.env.EVAL_SEED || 20261122)
let _s = SEED >>> 0
const rnd = () => {
  _s = (_s + 0x6D2B79F5) >>> 0
  let t = _s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const rawDir = path.join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
const mine = [], his = []
for (const f of fs.readdirSync(rawDir).filter((x) => x.endsWith('.jsonl'))) {
  for (const l of fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n')) {
    if (!l) continue
    try {
      const o = JSON.parse(l)
      const t = String(o.text || '').trim().replace(/\s+/g, ' ')
      const n = [...t].length
      if (n < 12 || n > 60) continue
      if (/https?:\/\/|[`{}#]/.test(t)) continue
      if (o.who === 'memory') mine.push(t)
      else his.push(t)
    } catch {}
  }
}

const N = Math.min(30, mine.length)
const lines = ['# 盲测 · 短句版（四选一，挑最不像人的那条）', '', '两边都卡在 12–60 字，长度已拉平。共 ' + N + ' 题。', '']
const key = ['# 答案键（评完再看）', '']
for (let i = 0; i < N; i++) {
  const a = mine[Math.floor(rnd() * mine.length)]
  const opts = [a]
  while (opts.length < 4) {
    const c = his[Math.floor(rnd() * his.length)]
    if (c && !opts.includes(c)) opts.push(c)
  }
  for (let j = opts.length - 1; j > 0; j--) { const k2 = Math.floor(rnd() * (j + 1)); [opts[j], opts[k2]] = [opts[k2], opts[j]] }
  const aiIdx = opts.indexOf(a)
  lines.push('## 第 ' + (i + 1) + ' 题', '')
  opts.forEach((o, j) => lines.push('  ' + 'ABCD'[j] + '. ' + o))
  lines.push('')
  key.push('第 ' + (i + 1) + ' 题：' + 'ABCD'[aiIdx])
}
fs.writeFileSync('docs/盲测-短句.md', lines.join('\n') + '\n', 'utf8')
fs.writeFileSync('docs/盲测-短句-答案键.md', key.join('\n') + '\n', 'utf8')
console.log('  出题 ' + N + ' 题 · 我的短句池 ' + mine.length + ' · 他的短句池 ' + his.length)
