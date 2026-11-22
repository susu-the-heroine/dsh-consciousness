/**
 * 启动与规模的四个人数
 * ====================
 *
 *   node scripts/bench-startup.mjs cold     新进程首问（含模块加载）
 *   node scripts/bench-startup.mjs restart  索引已落盘时，重启后首问
 *   node scripts/bench-startup.mjs big [n]  大库：建索引、查询 p50/p95、内存峰值
 *
 * 前两个只读主海；第三个在沙箱里造合成向量，跑完自己删。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：三段各写一遍「按当前目录拼库」——换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
// 挪到顶上算一次，按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')

const mode = String(process.argv[2] || 'cold')
const T0 = Date.now()

if (mode === 'cold') {
  
  const { searchTool } = await import(LIB + '/tools.js')
  const tLoad = Date.now()
  const r = await searchTool.execute({ query: '经十路', limit: 3, review: false })
  const t1 = Date.now()
  console.log(`冷启动：模块加载 ${tLoad - T0}ms · 首问 ${t1 - tLoad}ms · 合计 ${t1 - T0}ms`)
  console.log('结果条数：' + (String(r.log || '').match(/· #\d+/g) || []).length)
  process.exit(0)
}

if (mode === 'restart') {
  
  const ann = await import(LIB + '/ann.js')
  const tA = Date.now()
  const idx = ann.loadDisk('main', 'single')
  const tB = Date.now()
  const { searchTool } = await import(LIB + '/tools.js')
  const tC = Date.now()
  const r = await searchTool.execute({ query: '经十路', limit: 3, review: false })
  const tD = Date.now()
  console.log(`重启首问：读索引 ${tB - tA}ms（${idx ? '有' : '没有'}盘上索引）· 加载模块 ${tC - tB}ms · 首问 ${tD - tC}ms`)
  console.log('结果条数：' + (String(r.log || '').match(/· #\d+/g) || []).length)
  process.exit(0)
}

if (mode === 'big') {
  const n = Math.max(10000, Number(process.argv[3]) || 100000)
  const home = mkdtempSync(join(tmpdir(), 'sea-big-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  mkdirSync(join(home, '.dsh'), { recursive: true })
  
  const { SEAS_DIR } = await import(LIB + '/paths.js')
  const VX = await import(LIB + '/vecstore.js')
  const { loadVectors } = await import(LIB + '/vectors.js')
  const ann = await import(LIB + '/ann.js')
  const sea = 'big'
  mkdirSync(join(SEAS_DIR, sea), { recursive: true })

  const ent = []
  for (let i = 1; i <= n; i++) {
    const v = new Float32Array(512)
    for (let k = 0; k < 512; k++) v[k] = Math.sin(i * 0.011 + k * 0.27) + Math.cos(i * 0.003 * (1 + (k % 5)))
    ent.push({ id: i, v, h: 'b' + i })
  }
  VX.putMany(sea, ent)
  const vmap = loadVectors(sea)
  const rssLoad = process.memoryUsage().rss
  const t0 = Date.now()
  ann.build(sea, vmap)
  const buildMs = Date.now() - t0
  const rssBuild = process.memoryUsage().rss

  const qs = []
  for (let q = 0; q < 30; q++) {
    const v = new Float32Array(512)
    for (let k = 0; k < 512; k++) v[k] = Math.sin((q + 1) * 0.29 + k * 0.17) + Math.cos(q * 0.13 + k * 0.07)
    qs.push(v)
  }
  const ms = []
  for (const q of qs) {
    const t = Date.now()
    ann.probe(sea, q, vmap)
    ms.push(Date.now() - t)
  }
  ms.sort((a, b) => a - b)
  const p = (x) => ms[Math.min(ms.length - 1, Math.floor(x * ms.length))]
  console.log(`${n} 条：建索引 ${buildMs}ms · 载体 ${Math.round(rssLoad / 1048576)}MB · 建后 ${Math.round(rssBuild / 1048576)}MB`)
  console.log(`粗筛 p50 ${p(0.5)}ms · p95 ${p(0.95)}ms · 最慢 ${ms[ms.length - 1]}ms`)
  try { rmSync(join(SEAS_DIR, sea), { recursive: true, force: true }) } catch {}
  process.exit(0)
}

console.log('用法：cold | restart | big [n]')
process.exit(1)
