/**
 * 别人不会按题本上的话问
 * ======================
 *
 *   node scripts/query-noise-test.mjs
 *
 * 拿留出集的原句，改成人嘴里常见的四种毛边：加问号、加客套、逐字加空格、去掉疑问词。
 * 只读：不写库、不动索引。判据是"结论跟原句一致"——不是命中率，而是稳不稳。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const setPath = join(HERE, 'data', 'recall-holdout.json')
const cases = JSON.parse(readFileSync(setPath, 'utf8')).cases || []
// 2026-11-21：这里直接读主库，没有就崩成一段栈。而且没库时「结论一致」也算不出来。
// 先看有没有；没有就说清楚、退出码二——别让脚本在空环境里假装跑过。
const libPath = join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json')
if (!existsSync(libPath)) {
  console.log('读不到主库：' + libPath)
  console.log('这份测的是「换个问法结论稳不稳」，没有库就没有可比的对象。')
  process.exit(2)
}
const data = JSON.parse(readFileSync(libPath, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[\s，。！？、,.!?；;：:“”"'（）()【】\[\]]/g, '')
const grams = (s) => {
  const o = new Set()
  const t = norm(s)
  for (const seg of (t.match(/[\u4e00-\u9fa5]+/g) || [])) for (let i = 0; i + 2 <= seg.length; i++) o.add(seg.slice(i, i + 2))
  for (const w of (t.match(/[a-z0-9]{2,}/g) || [])) o.add(w)
  return o
}
const txt = (p) => [p.title, p.text, p.alias].filter(Boolean).join(' ')
const score = (q, p) => {
  const a = grams(q)
  const b = grams(txt(p))
  let n = 0
  for (const g of a) if (b.has(g)) n++
  return n / Math.max(1, a.size)
}
const top1 = (q) => {
  let best = null
  for (const p of pts) {
    const s = score(q, p)
    if (!best || s > best[0]) best = [s, p.id]
  }
  return best ? best[1] : null
}

const variants = [
  ['加问号', (q) => q + '？'],
  ['加客套', (q) => '请问一下，' + q],
  ['逐字加空格', (q) => q.split('').join(' ')],
  ['去掉疑问词', (q) => q.replace(/吗|呢|吧$/g, '')],
]

let worst = 1
const lines = []
for (const [name, fn] of variants) {
  let same = 0
  let total = 0
  for (const c of cases) {
    const want = c.want || c.id
    if (!want) continue
    total++
    const base = top1(c.q) === want
    const pert = top1(fn(c.q)) === want
    if (base === pert) same++
  }
  const ratio = total ? same / total : 1
  worst = Math.min(worst, ratio)
  lines.push(`${name}：跟原句结论一致 ${same}/${total}`)
}

console.log(lines.join('\n'))
const ok = worst >= 0.9
console.log(ok
  ? '换四种问法，结论都稳——标点、客套、空格不会把答案冲掉。'
  : '不对：有问法一扰动结论就翻，说明靠的是字面巧合，不是真的懂那件事。')
process.exit(ok ? 0 : 1)
