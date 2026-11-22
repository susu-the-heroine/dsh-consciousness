/**
 * 对了，是凭什么对的
 * ================
 *
 *   node scripts/audit-reasons.mjs
 *
 * 只看真库那批题里「头名答对」的那些，看它凭什么排到第一：
 * 凭原词命中、凭换说法、凭指代，还是凭保底救回来的。
 * 救回来的也算对，但要单独记——那种对，问法一变就可能散。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

const file = join(HERE, 'data', 'big-eval.json')
if (!existsSync(file)) {
  console.log('没找到 big-eval.json')
  process.exit(1)
}
const suite = JSON.parse(readFileSync(file, 'utf8'))
const cases = (suite.cases || []).filter((c) => c && c.want && c.q && !c.kind || (c && c.want && c.q))

const top = (log) => {
  for (const line of String(log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) return { id: Number(m[1]), line }
  }
  return { id: 0, line: '' }
}

const bucket = { 直命中: 0, 换说法: 0, 救回: 0, 其它: 0, 没中: 0 }
const risky = []
const miss = []
let n = 0

for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: 3, review: false })
  const t = top(r.log)
  n++
  if (t.id !== Number(c.want)) { bucket['没中']++; miss.push({ q: String(c.q).slice(0, 34), want: Number(c.want), got: t.id }); continue }
  if (/直扫救回/.test(t.line)) { bucket['救回']++; risky.push(String(c.q).slice(0, 30)); continue }
  if (/语义/.test(t.line)) { bucket['换说法']++; continue }
  if (/命中/.test(t.line)) { bucket['直命中']++; continue }
  bucket['其它']++
}

const rate = (k) => ((bucket[k] / (n || 1)) * 100).toFixed(1) + '%'
console.log(`题 ${n} 道`)
for (const k of ['直命中', '换说法', '救回', '其它', '没中']) console.log(`  ${k}：${bucket[k]}（${rate(k)}）`)
if (miss.length) {
  console.log('没中的（前十二）：')
  for (const m of miss.slice(0, 12)) console.log('  ' + m.q + ' | 要 #' + m.want + ' 得 #' + (m.got || 0))
}
if (risky.length) {
  console.log('靠救回来的题（问法一变可能散）：')
  for (const q of risky.slice(0, 8)) console.log('  ' + q)
}
