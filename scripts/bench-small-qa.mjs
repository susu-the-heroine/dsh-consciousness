/**
 * 小题库基准（三档，每档最多三十题；2026-11-21 实测是 16 / 30 / 30，头里原来写「各二十」）
 *
 *   node scripts/bench-small-qa.mjs
 *
 * 只读。跑完写 latest.json，第一次跑写 floor.json（各档减两分）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { pickCases, summarize, floorsOf } = await import(LIB + '/smallqa.js')
const { searchTool } = await import(LIB + '/tools.js')

const cases = JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || []
// 短指代那一档源题不够：补一批人工写的短问句（问法照口语，答案是真条目）
const extraFile = join(HERE, 'data', 'small-qa-extra.json')
// 个人题库默认不进公共地板：只对一个人成立（2026-11-19）
if (process.env.C2_PERSONAL_QA === '1' && existsSync(extraFile)) {
  try { cases.push(...JSON.parse(readFileSync(extraFile, 'utf8'))) } catch {}
}
const sets = pickCases(cases, 30)

const out = {}
for (const [name, list] of Object.entries(sets)) {
  const rows = []
  for (const c of list) {
    const r = await searchTool.execute({ query: c.q, limit: 8, review: false })
    const ids = [...String((r && (r.log || r.text)) || '').matchAll(/#(\d+)(?![0-9])/g)].map((m) => Number(m[1]))
    const idx = ids.indexOf(Number(c.want))
    rows.push({ q: c.q, want: c.want, rank: idx < 0 ? 0 : idx + 1 })
  }
  out[name] = summarize(rows)
  const miss = rows.filter((x) => !x.rank).slice(0, 3)
  console.log(`${name}: ${out[name].n} 题 · 头名 ${out[name].top1}% · 前三 ${out[name].top3}%` + (miss.length ? `（没进：${miss.map((m) => m.q.slice(0, 12)).join(' / ')}）` : ''))
}

const dir = join(HERE, 'data')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'small-qa-latest.json'), JSON.stringify(out, null, 2), 'utf8')
const floorFile = join(dir, 'small-qa-floor.json')
if (!existsSync(floorFile)) {
  writeFileSync(floorFile, JSON.stringify(floorsOf(out), null, 2), 'utf8')
  console.log('已写下地板')
}
console.log('完成')
process.exit(0)
