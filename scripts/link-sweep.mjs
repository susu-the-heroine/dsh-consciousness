/**
 * 关系网 · 先量再连
 * ================
 *
 *   node scripts/link-sweep.mjs           只看（默认）
 *   node scripts/link-sweep.mjs --dry     同上，说得更细
 *
 * 只读。按"两条都提到同一个实体"算能连出多少条边，
 * 顺便报哪些实体太大众（比如"识海"能连上千条，那种不该连）。
 *
 * 这一步是 0.5.0 设计里说的"数据说话，再决定要不要真写边"。
 */
import { dirname, join } from 'node:path'
import { isMainSea } from './_guard-main.mjs'

import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))

const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const data = S.readSea(sea)
const alive = (data.points || []).filter((p) => !p.dead && !p.archived)

const groups = new Map()
for (const p of alive) {
  // 字段叫 entities（复数），2026-11-15 第一次写成 entity 读了个空
  const raw = p.entities ?? p.entity
  const ents = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  for (const e of ents) {
    const k = String(e || '').trim()
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(p)
  }
}

let pairs = 0
const rows = []
for (const [ent, list] of groups) {
  const n = list.length
  if (n < 2) continue
  const pairsOf = (n * (n - 1)) / 2
  pairs += pairsOf
  rows.push({ ent, n, pairs: pairsOf })
}
rows.sort((a, b) => b.pairs - a.pairs)

console.log(`识海 ${sea}：在用 ${alive.length} 条，提到实体的 ${alive.filter((p) => Array.isArray(p.entities) && p.entities.length).length} 条，实体 ${groups.size} 个`)
console.log(`按"同实体"能连出 ${pairs} 条边（去重前的粗算）`)
console.log('')
console.log('最粗的十个实体：')
for (const r of rows.slice(0, 10)) {
  const flag = r.n > 30 ? '  ← 太大众，连了等于没连' : ''
  console.log(`  ${r.ent}：${r.n} 条，能连 ${r.pairs} 对${flag}`)
}

// 按设计里的上限再算一遍：每实体只连最近 5 条，每条记忆最多留 6 条边
const byBorn = new Map()
for (const p of alive) byBorn.set(p.id, Number(p.born) || 0)
const capEdges = new Map()
for (const [ent, list] of groups) {
  if (list.length < 2) continue
  const recent = [...list].sort((a, b) => (byBorn.get(b.id) || 0) - (byBorn.get(a.id) || 0)).slice(0, 5)
  const hub = recent[0]
  for (const other of recent.slice(1)) {
    const k = [hub.id, other.id].sort((x, y) => x - y).join('-')
    if (!capEdges.has(k)) capEdges.set(k, { a: hub.id, b: other.id, ent })
  }
}
// 每条最多 6 条边：按 id 出现次数超了就丢后面的
const deg = new Map()
const kept = []
for (const e of capEdges.values()) {
  const da = deg.get(e.a) || 0, db = deg.get(e.b) || 0
  if (da >= 6 || db >= 6) continue
  deg.set(e.a, da + 1); deg.set(e.b, db + 1)
  kept.push(e)
}
console.log('')
console.log(`按上限（每实体最近 5 条、每条最多 6 边）算：${kept.length} 条边，覆盖 ${deg.size} 条记忆`)
const hist = new Map()
for (const n of deg.values()) hist.set(n, (hist.get(n) || 0) + 1)
console.log('度分布：' + [...hist].sort((a, b) => a[0] - b[0]).map(([d, c]) => `${d}边×${c}条`).join('，'))

// 另一种：大众实体（>30 条）整个不连，小众实体全连，每条最多 8 边
const deg2 = new Map()
const kept2 = []
for (const [ent, list] of groups) {
  if (list.length < 2 || list.length > 30) continue
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].id, b = list[j].id
      const k = [a, b].sort((x, y) => x - y).join('-')
      if (kept2.some((e) => e.k === k)) continue
      const da = deg2.get(a) || 0, db = deg2.get(b) || 0
      if (da >= 8 || db >= 8) continue
      deg2.set(a, da + 1); deg2.set(b, db + 1)
      kept2.push({ k, ent })
    }
  }
}
console.log(`另一种（跳过 >30 条的大众实体、每条最多 8 边）：${kept2.length} 条边，覆盖 ${deg2.size} 条记忆`)

const big = rows.filter((r) => r.n > 30).reduce((s, r) => s + r.pairs, 0)
console.log('')
console.log(`其中 ${big} 条边来自超过 30 条的大众实体，真要连得先给个上限（比如每实体只连最近 5 条）`)
const apply = process.argv.includes('--apply')
const forceMain = process.argv.includes('--force-main')
if (!apply) {
  console.log('这只是看数，没写任何东西。要真写就加 --apply（主库还要再加 --force-main）。')
} else if (isMainSea(sea) && !forceMain) {
  console.log('主库不让直接连边。先在沙箱海跑通，再来动它（要动就加 --force-main，并且先备份）。')
  process.exit(2)
} else {
  const rel = kept2.map((e) => {
    const [a, b] = e.k.split('-').map(Number)
    return { a, b, kind: 'same-entity', w: 0.6, why: '都在说「' + e.ent + '」', madeAt: Date.now() }
  })
  // 幂等：已经连过的边不重复写
  const old = Array.isArray(data.relations) ? data.relations : []
  const seen = new Set(old.map((r) => [r.a, r.b].sort((x, y) => x - y).join('-')))
  const addn = rel.filter((r) => !seen.has([r.a, r.b].sort((x, y) => x - y).join('-')))
  if (!addn.length) {
    console.log('边已经都在了，没新增。')
    process.exit(0)
  }
  S.backupSea(sea)
  data.relations = old.concat(addn)
  S.writeSea(sea, data)
  console.log(`写了 ${addn.length} 条边进 ${sea}（原有 ${old.length} 条），已先备份。`)
}
