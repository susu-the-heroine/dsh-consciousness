/**
 * 反证实验：两边都是真人，让评者挑「哪个更像人」
 * ================================================
 *   node scripts/both-human.mjs
 *
 * 苏苏侠的话 vs LCCC 里随便一个网友的话，两边都是真人说的。
 * 如果评者还能挑出「哪个更像人」，那说明这道题本身没有答案——
 * 因为两边本来就都是人。这正是「像不像人」不能当验收的理由。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SEED = 20261122
let s = SEED >>> 0
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }

const dir = join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
const his = []
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!l) continue
    try {
      const o = JSON.parse(l)
      if (o.who === 'memory') continue
      const t = String(o.text || '').replace(/\s+/g, '').trim()
      if (t.length >= 8 && t.length <= 40 && /^[\u4e00-\u9fa5，。！？、…—]+$/.test(t) && !/goal_round|Objective/.test(t)) his.push(t)
    } catch {}
  }
}
const clean = (t) => String(t).replace(/\s+/g, '').trim()
const other = []
if (existsSync('docs/多人语料-LCCC-toy.txt')) {
  for (const line of readFileSync('docs/多人语料-LCCC-toy.txt', 'utf8').split('\n')) {
    for (const part of line.split('\t')) {
      const t = clean(part)
      if (t.length >= 8 && t.length <= 40 && /^[\u4e00-\u9fa5，。！？、…—]+$/.test(t)) other.push(t)
    }
  }
}
for (let i = his.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [his[i], his[j]] = [his[j], his[i]] }

const q = ['# 反证：两边都是真人（10 组）', '', '每组 A、B 各是不同人打的一句。挑「更像人打的」那句。', '']
const key = ['# 答案键', '']
for (let i = 0; i < 10; i++) {
  const h = his[i]
  const o = other[Math.floor(rnd() * other.length)]
  const flip = rnd() < 0.5
  q.push('## ' + (i + 1), '', 'A. ' + (flip ? o : h), '', 'B. ' + (flip ? h : o), '')
  key.push((i + 1) + '. ' + (flip ? 'B' : 'A') + ' 是他')
}
writeFileSync('docs/反证-两边都是真人-10组.md', q.join('\n') + '\n', 'utf8')
writeFileSync('docs/反证-两边都是真人-答案键.md', key.join('\n') + '\n', 'utf8')
console.log('  10 组已生成 · 题面 docs/反证-两边都是真人-10组.md')
