/**
 * 多人基线（LCCC 中文对话，公开语料，非他一个人）
 * ================================================
 *   node scripts/style-multi.mjs
 *
 * 数据：docs/多人语料-LCCC-toy.txt（thu-coai/CDial-GPT 的 toy_train，经 ghproxy 取回）
 *      每行一句对话对，制表符分隔，字之间带空格——先去掉字间空格。
 *
 * 量四项，和他的短句池、我的回复并列：
 *   中位句长、问号率、感叹号率、半句率（结尾不带句末标点）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const clean = (s) => String(s).replace(/\s+/g, '').trim()
const metrics = (arr) => {
  const lens = [], q = [], ex = [], half = []
  for (const a of arr) {
    const t = clean(a)
    if (!t || t.length < 2) continue
    lens.push(t.length)
    q.push(/[？?]/.test(t) ? 1 : 0)
    ex.push(/[！!]/.test(t) ? 1 : 0)
    half.push(/[。！？!?…~～]$/.test(t) ? 0 : 1)
  }
  lens.sort((a, b) => a - b)
  const avg = (x) => (x.reduce((s, v) => s + v, 0) / Math.max(1, x.length) * 100).toFixed(1) + '%'
  return {
    n: lens.length,
    med: lens[Math.floor(lens.length / 2)] || 0,
    p90: lens[Math.floor(lens.length * 0.9)] || 0,
    q: avg(q), ex: avg(ex), half: avg(half),
  }
}

// 1) LCCC
const lccc = []
if (existsSync('docs/多人语料-LCCC-toy.txt')) {
  for (const line of readFileSync('docs/多人语料-LCCC-toy.txt', 'utf8').split('\n')) {
    for (const part of line.split('\t')) if (part.trim()) lccc.push(part)
  }
}
// 2) 我的回复（20 条手抄）
const mine = []
if (existsSync('docs/我的回复-20条.md')) {
  for (const l of readFileSync('docs/我的回复-20条.md', 'utf8').split('\n')) {
    if (/^\d+\. /.test(l)) mine.push(l.replace(/^\d+\.\s*/, ''))
  }
}
// 3) 他的短句（流水里 6–60 字的 user 消息）
const his = []
const rawDir = join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
if (existsSync(rawDir)) {
  for (const f of readdirSync(rawDir).filter((x) => x.endsWith('.jsonl'))) {
    for (const l of readFileSync(join(rawDir, f), 'utf8').split('\n')) {
      if (!l) continue
      try {
        const o = JSON.parse(l)
        const t = clean(o.text || '')
        if (o.who !== 'memory' && t.length >= 4 && t.length <= 60) his.push(t)
      } catch {}
    }
    if (his.length > 5000) break
  }
}

const A = metrics(lccc), B = metrics(his), C = metrics(mine)
const rows = [
  ['样本', A.n, B.n, C.n],
  ['中位句长', A.med, B.med, C.med],
  ['P90 句长', A.p90, B.p90, C.p90],
  ['问号率', A.q, B.q, C.q],
  ['感叹号率', A.ex, B.ex, C.ex],
  ['半句率', A.half, B.half, C.half],
]
console.log('  项            LCCC多人      他          我')
for (const r of rows) console.log('  ' + String(r[0]).padEnd(12) + String(r[1]).padEnd(14) + String(r[2]).padEnd(12) + r[3])
