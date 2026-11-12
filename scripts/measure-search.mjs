/**
 * 检索命中率：直接调 memory_search 那个工具，不问接口（接口根本不存在）。
 *
 * 做法：从真库里挑 N 条有区分度标题的记忆，用标题里的词当问句，
 * 看返回的前三条里有没有它自己。
 *
 * 只读，不写库。结果落 ~/.dsh/consciousness-sim/search-hit.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const D = join(homedir(), '.dsh')
const sea = JSON.parse(readFileSync(join(D, 'consciousness-seas', 'main', 'data.json'), 'utf8'))
const pts = (sea.points || []).filter((p) => !p.dead && !p.archived)

const mod = await import('file:///' + join(D, 'plugin-src', 'dsh-consciousness', 'lib', 'tools.js').replace(/\\/g, '/'))
const tool = mod.searchTool || mod.default?.searchTool
if (!tool || !tool.execute) {
  console.log('找不到 searchTool.execute，导出名有：' + Object.keys(mod).join(','))
  process.exit(2)
}

// 挑 12 条：标题至少 8 个字，避免太泛
const sample = pts.filter((p) => [...String(p.title || '')].length >= 8).slice(-12)
let hit = 0
const rows = []
for (const p of sample) {
  const words = String(p.title).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ' ').split(/\s+/).filter((w) => [...w].length >= 2)
  const q = (words.slice(0, 2).join(' ') || String(p.title).slice(0, 6)).trim()
  let ok = false
  let first = ''
  try {
    const r = await tool.execute({ query: q, limit: 3 }, {})
    const log = String((r && (r.log || r.text)) || '')
    first = (log.split('\n').find((l) => l.trim().startsWith('·')) || '').trim().slice(0, 40)
    ok = log.includes(String(p.title).slice(0, 8))
  } catch (e) {
    first = '调用出错：' + String((e && e.message) || e).slice(0, 50)
  }
  if (ok) hit++
  rows.push({ q, id: p.id, title: String(p.title).slice(0, 24), hit: ok, first })
  console.log((ok ? '中 ' : '空 ') + q + '  →  ' + (ok ? '命中' : first || '没命中'))
}

const rate = sample.length ? +(hit / sample.length).toFixed(2) : null
console.log('')
console.log('命中 ' + hit + '/' + sample.length + '（' + (rate != null ? rate * 100 : '—') + '%）')
writeFileSync(join(D, 'consciousness-sim', 'search-hit.json'), JSON.stringify({ at: Date.now(), n: sample.length, hit, rate, rows }, null, 1), 'utf8')
