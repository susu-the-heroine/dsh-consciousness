/**
 * 判错分析
 * ========
 *
 *   node scripts/analyze-feedback.mjs [条数]
 *
 * 读真实判错记录（~/.dsh/consciousness/feedback.jsonl），看该往哪儿补：
 * 每条形如「问句 / 期望编号 / 实际给了 / 结论」。
 * 有期望编号的，把期望那条标题里出现、而问句里没有的词拎出来，当候选。
 *
 * 只读，不改词表。攒够样本再动手，别凭印象编。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { readSea } = await import(LIB + '/store.js')

const ai = process.argv.indexOf('--file')
const fp = ai > 0 && process.argv[ai + 1] ? String(process.argv[ai + 1]) : join(homedir(), '.dsh', 'consciousness', 'feedback.jsonl')
const limit = Math.max(1, Number(process.argv[2]) || 500)

if (!existsSync(fp)) {
  console.log('还没有判错记录——文件不存在。')
  console.log('先让人用 memory_judge 判几次错，再来分析。')
  process.exit(0)
}

const lines = readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean)
const recs = []
for (const l of lines.slice(-limit)) {
  try { recs.push(JSON.parse(l)) } catch {}
}
if (!recs.length) {
  console.log('文件在，但里面没有能解析的行。')
  process.exit(0)
}

const byVerdict = {}
for (const r of recs) byVerdict[r.verdict || '?'] = (byVerdict[r.verdict || '?'] || 0) + 1
console.log(`判错记录 ${recs.length} 条：` + Object.entries(byVerdict).map(([k, v]) => `${k} ${v}`).join(' · '))

// 2026-11-21：库不存在时 readSea 给 null，这里直接取 .points 会崩。先看有没有。
const _sea = readSea('main')
if (!_sea) {
  console.log('读不到主库（' + 'main' + '），先把库准备好再来分析。')
  process.exit(2)
}
const pts = (_sea.points || []).filter((p) => p && !p.dead && !p.archived)
const byId = new Map(pts.map((p) => [Number(p.id), p]))

const uniq = (s) => {
  const x = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= x.length; i++) out.add(x.slice(i, i + 2))
  return out
}

const gaps = []
for (const r of recs) {
  if (r.verdict === 'hit') continue
  const expect = byId.get(Number(r.expect))
  if (!expect) continue
  // 别拿二字组堆，那是糊的：按标点切段，只留「问句里没出现」的整段
  const qg = uniq(r.q)
  const segs = String(expect.title || '').split(/[，。、；：！？,.;:!?\s]+/).filter((s) => s.length >= 2)
  const missing = segs.filter((s) => {
    const g = uniq(s)
    for (const x of g) if (qg.has(x)) return false
    return true
  })
  if (!missing.length) continue
  gaps.push({ q: r.q, expect: expect.id, miss: missing.slice(0, 3).join(' / ') })
}

if (!gaps.length) {
  console.log('有记录，但没有能抽出「该补的词」的条目（可能没填期望编号）。')
  process.exit(0)
}

console.log(`能抽出候选的 ${gaps.length} 条，前几条：`)
for (const g of gaps.slice(0, 8)) {
  console.log(`  #${g.expect} 问「${String(g.q).slice(0, 18)}」→ 标题里这些词没问着：${g.miss}`)
}
console.log('注：这里只是候选，补词表要人看一遍，别自动写进去。')
process.exit(0)
