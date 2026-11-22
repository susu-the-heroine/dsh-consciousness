/**
 * 「哪句更像他说的」盲测
 * ========================
 *   node scripts/blind-vs-him.mjs <我的20条.md> <后缀>
 *
 * 为什么换这个尺子：拿 LCCC 泛泛的真人话当分母，两位评者给出 0/20 与 19/20，
 * 因为「更像人」没有唯一答案——泛泛的人、项目里的人，判法相反。
 * 换成「更像他说的」，分母是同一个人的原话，答案才有唯一解。
 *
 * 他的句子从流水里抽（who=user，4–40 字，纯中文），长度按字对齐我的句子。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SEED = 20261122
let s = SEED >>> 0
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }

const mineFile = process.argv[2] || 'docs/真人对照-我的20条-脏版.md'
const tag = process.argv[3] || '-对他'
if (!existsSync(mineFile)) { console.log('  缺我的句子文件'); process.exit(1) }

const mine = readFileSync(mineFile, 'utf8').split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim())

const dir = join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
const his = []
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!l) continue
    try {
      const o = JSON.parse(l)
      if (o.who === 'memory') continue
      const t = String(o.text || '').replace(/\s+/g, '').trim()
      if (t.length >= 4 && t.length <= 40 && /^[\u4e00-\u9fa5，。！？、…—]+$/.test(t) && !/goal_round|Objective|第\d+轮/.test(t)) his.push(t)
    } catch {}
  }
}
for (let i = his.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [his[i], his[j]] = [his[j], his[i]] }

const pairs = []
const used = new Set()
for (const m of mine) {
  const target = m.length
  let best = null, bestD = 99
  for (const h of his) {
    if (used.has(h)) continue
    const d = Math.abs(h.length - target)
    if (d < bestD) { bestD = d; best = h }
    if (d === 0) break
  }
  used.add(best)
  pairs.push({ mine: m, his: best })
}

const q = ['# 像他盲测（20 组）', '', '每题两句，一句是他本人发的，一句是我回的。挑「更像他本人发的」那句。', '']
const key = ['# 答案键（评者不许看）', '']
pairs.forEach((p, i) => {
  const flip = rnd() < 0.5
  q.push('## ' + (i + 1), '', 'A. ' + (flip ? p.his : p.mine), '', 'B. ' + (flip ? p.mine : p.his), '')
  key.push((i + 1) + '. ' + (flip ? 'A' : 'B') + ' 是他')
})
writeFileSync('docs/像他盲测-20组' + tag + '.md', q.join('\n') + '\n', 'utf8')
writeFileSync('docs/像他盲测-答案键' + tag + '.md', key.join('\n') + '\n', 'utf8')
console.log('  20 组已生成 · 后缀 ' + tag)
