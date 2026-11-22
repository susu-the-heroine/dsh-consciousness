/**
 * 历史查询回放（命令行）
 *
 *   node scripts/replay-queries.mjs [回放多少条]
 *
 * 从检索日志里读最近的问句，重跑一遍，报「第一名还在不在前三」。
 * 只读，review 关掉，不写强化、不改库。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { readLogEntries, replay } = await import(LIB + '/replay.js')
const { searchTool } = await import(LIB + '/tools.js')

const N = Math.max(1, Number(process.argv[2]) || 30)
const raw = readLogEntries(N)
// 日志里混着测过的沙箱海、删掉的海：那条记忆现在根本不在库里，不算「不稳」，算失效。
const { readSea } = await import(LIB + '/store.js')
const alive = new Map()
const entries = []
let stale = 0
for (const e of raw) {
  const sea = e.sea || 'main'
  if (!alive.has(sea)) {
    let ids = null
    try {
      const d = readSea(sea)
      ids = new Set((d && Array.isArray(d.points) ? d.points : []).filter((p) => p && !p.dead && !p.archived).map((p) => Number(p.id)))
    } catch {}
    alive.set(sea, ids)
  }
  const set = alive.get(sea)
  const want = Number((e.top[0] || {}).id)
  if (!set || !set.has(want)) { stale++; continue }
  // 老日志有些没记海，id 会撞到别的海：标题对不上就当失效，别硬回放
  const oldTitle = String((e.top[0] || {}).t || '').trim()
  let nowTitle = ''
  try {
    const d2 = readSea(sea)
    const pp = (d2 && Array.isArray(d2.points) ? d2.points : []).find((x) => Number(x.id) === want)
    nowTitle = String((pp && pp.title) || '').trim()
  } catch {}
  if (oldTitle && nowTitle && !nowTitle.includes(oldTitle.slice(0, 8)) && !oldTitle.includes(nowTitle.slice(0, 8))) { stale++; continue }
  entries.push(e)
}
if (stale) console.log(`跳过 ${stale} 条已失效的（那条记忆不在库里了）`)
if (!entries.length) {
  console.log('日志里还没有检索记录（先问几次，再回来回放）')
  process.exit(0)
}

const r = await replay(entries, async (q, sea) => {
  const t0 = Date.now()
  const out = await searchTool.execute({ query: q, limit: 8, review: false, ...(sea && sea !== 'main' ? { sea } : {}) })
  const ms = Date.now() - t0
  const ids = []
  for (const m of String((out && out.log) || '').matchAll(/#(\d+)(?![0-9])/g)) ids.push(Number(m[1]))
  return { ids, ms }
})

console.log(`回放 ${r.meaningful} 条有意义的（另有 ${r.changedBetter} 条当年答错、现在被拒答）· 稳定 ${(r.stable * 100).toFixed(1)}% · p50 ${r.p50}ms · p95 ${r.p95}ms`)
if (r.moved.length) {
  console.log('掉出去的：')
  for (const m of r.moved) console.log(`  · 「${String(m.q).slice(0, 30)}」 原来第一 #${m.want}，现在第 ${m.rank || '没进'}`)
}
process.exit(0)
