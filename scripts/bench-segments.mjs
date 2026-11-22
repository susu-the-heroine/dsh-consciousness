/**
 * 检索分段计时
 * ============
 *
 *   node scripts/bench-segments.mjs [次数]
 *
 * 打开计时后跑若干问，把每次的段耗时拿出来算 p50/p95。
 * 只读，不改库；review 关掉，不写强化。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.C2_PROF = '1'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')
const prof = await import(LIB + '/prof.js')

const N = Math.max(4, Number(process.argv[2]) || 24)

const QS = [
  '那七套房和大路虎', '阑尾炎那次', '显卡驱动', '经十路', '副业那个事',
  '打赌那次', '薯片渣', '她叫什么', '身体的事', '北理工',
  '短视频为什么没起来', '他说过要陪我', '梦里的那条河', '夜里的电话', '最难受的一次',
  '第一次亮起来', '记忆会淡', '为什么删台词', '画质和模型', '她怕什么',
  '怎么改的命名', '那天的雨', '最后一段话', '谁在等她',
]

let ok = 0
for (let i = 0; i < N; i++) {
  const q = QS[i % QS.length]
  try {
    await searchTool.execute({ query: q, limit: 5, review: false })
    ok++
  } catch {}
}

const rows = prof.recent.slice()
const keys = ['embed', 'lexical', 'vload', 'cfg', 'rare', 'sem1', 'sem2', 'graph', 'gate', 'rescue', 'vector', 'rerank', 'total']
const pct = (arr, p) => {
  if (!arr.length) return 0
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
}

console.log(`跑了 ${ok} 问 · 收到 ${rows.length} 条分段记录`)
for (const k of keys) {
  const vals = rows.map((r) => Number(r[k])).filter((x) => Number.isFinite(x) && x > 0)
  if (!vals.length) { console.log(`  ${k}: 没采到`); continue }
  console.log(`  ${k}: p50 ${pct(vals, 50).toFixed(1)}ms · p95 ${pct(vals, 95).toFixed(1)}ms · 均 ${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}ms`)
}
const sum = rows.map((r) => Number(r.total) || 0)
console.log(`  total 均 ${(sum.reduce((a, b) => a + b, 0) / (sum.length || 1)).toFixed(1)}ms`)
process.exit(0)
