/**
 * 检索速度的底线
 * ==============
 *
 *   node scripts/recall-latency-test.mjs [识海]
 *
 * 只防"塌方式变慢"：比如哪天不小心把整库读盘塞进了检索路径，
 * 中位数从两毫秒变成两百毫秒。阈值故意放宽（中位 50 毫秒、p90 200 毫秒），
 * 免得在忙的机器上误报。
 *
 * 2026-11-15 凌晨基线：沙箱海 118 条，中位 1.8 毫秒，最慢 4.1 毫秒。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'sandbox').trim() || 'sandbox'

if (!existsSync(join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json'))) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}

const C = await import('file:///' + join(HERE, '..', 'lib', 'candidates.js').replace(/\\/g, '/'))
const qs = ['经十路', '薯片 零食', 'GMod 视频 怎么拍', '阑尾炎 手术', '七套房', '那个关于本名的事', '插件 五家 对比', '昨天那个想法']

const times = []
for (let round = 0; round < 3; round++) {
  for (const q of qs) {
    const t0 = performance.now()
    // 2026-11-21：这里原来写 q ? sea : sea——两边都是 sea，等于没写。
    // 大概是当初想试"空问句走哪条路"，试完忘了收。照实写。
    C.candidatesFor(sea, q, {})
    times.push(performance.now() - t0)
  }
}
times.sort((a, b) => a - b)
const med = times[Math.floor(times.length / 2)]
const p90 = times[Math.floor(times.length * 0.9)]
const slow = times[times.length - 1]

console.log(`${times.length} 次检索：中位 ${med.toFixed(1)}ms · p90 ${p90.toFixed(1)}ms · 最慢 ${slow.toFixed(1)}ms`)

const ok = med < 50 && p90 < 200
console.log(ok ? '检索速度在底线上。' : '变慢了：中位或 p90 超线，先查是不是把读盘塞进检索了。')
process.exit(ok ? 0 : 1)
