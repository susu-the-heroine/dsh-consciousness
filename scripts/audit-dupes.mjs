/**
 * 库里的孪生条目（只读）
 * ====================
 *
 *   node scripts/audit-dupes.mjs [海名]
 *
 * 为查那二十五道「没中」：很多不是找错了，是库里同一件事挂着两条，
 * 谁排第一都对、也都错。这里把它们列出来，人自己决定并哪条。
 *
 * 只读，一个字都不写。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { readSea } = await import(LIB + '/store.js')

const sea = process.argv[2] || 'main'
const data = readSea(sea)
const pts = ((data && data.points) || []).filter((p) => p && !p.dead)

const bigrams = (s) => {
  const t = String(s || '').replace(/\s+/g, '')
  const m = new Map()
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}
const sim = (a, b) => {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const [k, v] of A) hit += Math.min(v, B.get(k) || 0)
  return hit / Math.max(1, Math.min(A.size, B.size))
}

const pairs = []
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const s = sim(pts[i].title, pts[j].title)
    if (s >= 0.62) pairs.push({ s, a: pts[i], b: pts[j] })
  }
}
pairs.sort((x, y) => y.s - x.s)

console.log(`海：${sea} · 条目 ${pts.length} · 题名很像的对 ${pairs.length}`)
for (const p of pairs.slice(0, 15)) {
  console.log(`  ${(p.s * 100).toFixed(0)}%  #${p.a.id} ${String(p.a.title).slice(0, 26)}  ‖  #${p.b.id} ${String(p.b.title).slice(0, 26)}`)
}
if (!pairs.length) console.log('  一对都没有')
