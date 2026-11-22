/**
 * 有正文却没向量——这种条目搜不到
 * ================================
 *
 *   node scripts/vector-gap.mjs           只看，不动
 *   node scripts/vector-gap.mjs --apply   补上缺的向量（只写 vectors.json，不碰正文）
 *
 * 为什么单做这一支：缺向量的条目在检索里几乎没有分，问十次都排不上。
 * 实测主库有五条这种（技术复盘那几条），连原句去搜都搜不到。
 */
import { copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const sea = (process.argv.find((a) => a.startsWith('--sea=')) || '').split('=')[1] || 'main'
const apply = process.argv.includes('--apply')

const S = await import('file:///' + join(ROOT, 'lib', 'store.js').replace(/\\/g, '/'))
const V = await import('file:///' + join(ROOT, 'lib', 'vectors.js').replace(/\\/g, '/'))
const E = await import('file:///' + join(ROOT, 'lib', 'embed-js.js').replace(/\\/g, '/'))

const data = S.readSea(sea)
if (!data || !Array.isArray(data.points)) {
  console.log('读不到这个海：' + sea)
  process.exit(1)
}
const alive = data.points.filter((p) => !p.dead && !p.archived)
const vecs = E.readVectors(sea) || {}
const gap = alive.filter((p) => !vecs[String(p.id)])

console.log(`${sea}：在用 ${alive.length} 条，有向量 ${alive.length - gap.length} 条，缺 ${gap.length} 条`)
for (const p of gap.slice(0, 20)) console.log(`  #${p.id} ${String(p.title || '').slice(0, 30)}`)

if (!gap.length) {
  console.log('没有缺的。')
  process.exit(0)
}
if (!apply) {
  console.log('要补就在命令后面加 --apply。它只写 vectors.json，不动正文。')
  process.exit(0)
}

// 先留一份，补坏了能退回去
const vp = E.vectorsPath(sea)
if (existsSync(vp)) {
  const bak = vp + '.bak-vectorgap'
  copyFileSync(vp, bak)
  console.log('先备份：' + bak)
}

let added = 0
for (const p of gap) {
  try {
    const ok = await V.ensureVectorFor(sea, p)
    if (ok) added++
  } catch (e) {
    console.log(`#${p.id} 补失败：${String(e && e.message || e).slice(0, 80)}`)
  }
}
const after = E.readVectors(sea) || {}
const left = alive.filter((p) => !after[String(p.id)]).length
console.log(`补了 ${added} 条，还剩 ${left} 条没向量。`)
process.exit(left === 0 ? 0 : 1)
