/**
 * 封存卷 blind-30：只报总分，不报逐条
 * =====================================
 *   node scripts/blind-run.mjs            # 只报三项，够判断
 *   node scripts/blind-run.mjs --detail   # 想看逐条才加，看完不许照它调参
 *
 * 为什么只报总分：卷子的用处是「改完到底行不行」，不是「再刷一遍找分」。
 * 逐条摊开会诱着人按题面调参，那这卷就废了。
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL = homedir()
const detail = process.argv.includes('--detail')

const pack = JSON.parse(readFileSync(join(HERE, 'data', 'blind-30.json'), 'utf8'))
const cases = pack.cases || []

const tmp = mkdtempSync(join(tmpdir(), 'blind-'))
mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })
cpSync(join(REAL, '.dsh', 'consciousness-seas', 'main'), join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
process.env.USERPROFILE = tmp
process.env.HOME = tmp

const { searchTool } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

let top1 = 0
let top3 = 0
let top10 = 0
const rows = []
// 2026-11-21：临时家是整份库的拷贝，实测地上躺过一个 188 MB 的 blind-*，是之前跑崩留下的。
// 正常跑完会收，但中途出错就留在原地。既然要拷这么多，就得保证出错也收。
try {
for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: 10, review: false })
  const ids = []
  for (const line of String(r.log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) ids.push(Number(m[1]))
  }
  const at = ids.indexOf(Number(c.want))
  if (at === 0) top1++
  if (at >= 0 && at < 3) top3++
  if (at >= 0) top10++
  rows.push({ q: c.q, want: c.want, got: ids.slice(0, 5), rank: at < 0 ? null : at + 1 })
}

const pct = (a) => ((100 * a) / cases.length).toFixed(1)
console.log(`封存卷 ${cases.length} 题（${pack.meta && pack.meta.name}）`)
console.log(`头名 ${top1}/${cases.length} = ${pct(top1)}%｜前三 ${pct(top3)}%｜前十 ${pct(top10)}%`)
if (detail) {
  console.log('')
  for (const r of rows) console.log(`  ${r.rank == null ? '漏' : '第' + r.rank}  ${r.q} → 要 #${r.want}，拿 ${r.got.join(',') || '空'}`)
}
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
}
