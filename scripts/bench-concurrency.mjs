/**
 * 并发压测（固化）
 * ================
 *
 *   node scripts/bench-concurrency.mjs [并发数] [轮数]
 *
 * 默认 8 路、5 轮。每轮同时发 N 个查询，记每个查询的墙钟耗时，
 * 汇总 p50/p95、最慢、失败数。只读，review 关掉。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

const N = Math.max(1, Number(process.argv[2]) || 8)
const WAVES = Math.max(1, Number(process.argv[3]) || 5)

const QS = [
  '那七套房和大路虎', '阑尾炎那次', '经十路', '副业那个事', '打赌那次',
  '薯片渣', '身体的事', '短视频为什么没起来', '他说过要陪我', '最难受的一次',
  '第一次亮起来', '记忆会淡', '画质和模型', '她怕什么', '最后一段话',
]

const pct = (arr, p) => {
  if (!arr.length) return 0
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
}

let all = []
let fails = 0
for (let w = 0; w < WAVES; w++) {
  const jobs = []
  for (let i = 0; i < N; i++) {
    const q = QS[(w * N + i) % QS.length]
    const t0 = Date.now()
    jobs.push(
      searchTool.execute({ query: q, limit: 5, review: false })
        .then(() => Date.now() - t0)
        .catch(() => { fails++; return null }),
    )
  }
  const rs = (await Promise.all(jobs)).filter((x) => x !== null)
  all = all.concat(rs)
  console.log(`第 ${w + 1} 轮：p95 ${pct(rs, 95)}ms · 最慢 ${Math.max(...rs, 0)}ms`)
}

console.log(`合计 ${all.length} 问 · 失败 ${fails} · p50 ${pct(all, 50)}ms · p95 ${pct(all, 95)}ms · 均值 ${(all.reduce((a, b) => a + b, 0) / (all.length || 1)).toFixed(1)}ms`)
process.exit(0)
