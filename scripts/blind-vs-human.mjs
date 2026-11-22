/**
 * 真人对照盲测（多人语料 vs 我的回复）
 * =====================================
 *   node scripts/blind-vs-human.mjs
 *
 * 一、从 LCCC 多人语料里抽 20 句真人说的话，长度对齐我的 20 条（12–45 字）。
 * 二、每题把「真人的一句」和「我的一句」随机放左右，写题面 + 答案键（分开两个文件）。
 * 三、评者不知道哪边是真人，只挑「更像真人在聊天里打出来的」。
 *
 * 这是唯一一个「不用他当尺、也不用我当尺」的像人率：分母是真人真话。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const SEED = 20261122
let s = SEED >>> 0
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }

const mineFile = process.argv[2] || 'docs/真人对照-我的20条.md'
const tag = process.argv[3] || ''
if (!existsSync(mineFile) || !existsSync('docs/多人语料-LCCC-toy.txt')) {
  console.log('  缺输入文件'); process.exit(1)
}

const mine = readFileSync(mineFile, 'utf8').split('\n')
  .filter((l) => /^\d+\. /.test(l))
  .map((l) => l.replace(/^\d+\.\s*/, '').trim())

const clean = (t) => String(t).replace(/\s+/g, '').trim()
const cands = []
for (const line of readFileSync('docs/多人语料-LCCC-toy.txt', 'utf8').split('\n')) {
  for (const part of line.split('\t')) {
    const t = clean(part)
    if (t.length >= 12 && t.length <= 45 && /^[\u4e00-\u9fa5，。！？、…—]+$/.test(t)) cands.push(t)
  }
}
// 打乱候选
for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]] }

const pairs = []
const usedHuman = new Set()
for (const m of mine) {
  const target = clean(m).length
  // 找长度最接近的真人句
  let best = null, bestD = 99
  for (const c of cands) {
    if (usedHuman.has(c)) continue
    const d = Math.abs(c.length - target)
    if (d < bestD) { bestD = d; best = c }
    if (d === 0) break
  }
  usedHuman.add(best)
  pairs.push({ mine: m, human: best })
}

const q = ['# 真人对照盲测（20 组）', '', '每题两句，一句是真人说的，一句是 AI 说的。挑「更像真人在聊天里打出来的」那一句。', '']
const key = ['# 答案键（评者不许看）', '']
pairs.forEach((p, i) => {
  const flip = rnd() < 0.5
  const A = flip ? p.human : p.mine
  const B = flip ? p.mine : p.human
  q.push('## ' + (i + 1), '', 'A. ' + A, '', 'B. ' + B, '')
  key.push((i + 1) + '. ' + (flip ? 'A' : 'B') + ' 是真人')
})
writeFileSync('docs/真人对照盲测-20组' + tag + '.md', q.join('\n') + '\n', 'utf8')
writeFileSync('docs/真人对照盲测-答案键' + tag + '.md', key.join('\n') + '\n', 'utf8')
console.log('  20 组已生成 · 后缀 ' + (tag || '（无）'))
