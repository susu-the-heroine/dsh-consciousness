import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 规模四组数
 * ==========
 *   node scripts/bench-scale.mjs [倍数...]
 *
 * 用主海的真向量脱敏放大到十倍、五十倍，跑四组：
 *   冷启动（新进程：读库 + 首次检索）
 *   检索（同进程连续三十问，端到端 p50/p95）
 *   并发（八个同时问，p95）
 *   补齐（故意留一百条没有向量，量补回速度）
 *
 * 全部在临时目录里造，碰不到真库。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const LIB = 'file:///' + join(process.cwd(), 'lib').replace(/\\/g, '/')

// 先从真库取一份向量（这时 HOME 还是真的），再切到临时目录造大库
const Vreal = await import(LIB + '/vectors.js')
const src = Vreal.loadVectors('main')
const ids = [...src.keys()]
if (ids.length < 50) { console.log('主海向量不足，先跑一次检索/补齐'); process.exit(1) }

const home = mkdtempSync(join(tmpdir(), 'sea-scale-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
const Q = '?sandbox=' + Date.now()
const { writeSea, readSea } = await import(LIB + '/store.js' + Q)
const V = await import(LIB + '/vectors.js' + Q)
const VX = await import(LIB + '/vecidx.js' + Q)
const { SEAS_DIR } = await import(LIB + '/paths.js' + Q)

const multi = (process.argv.slice(2).map(Number).filter((x) => x > 0))
const mults = multi.length ? multi : [10, 50]

const pct = (arr, p) => {
  const x = [...arr].sort((a, b) => a - b)
  return x[Math.min(x.length - 1, Math.floor(x.length * p))]
}

function build(sea, mult, omit = 0) {
  const points = []
  const vecs = {}
  const now = Date.now()
  let n = 0
  for (let c = 0; c < mult; c++) {
    for (const id of ids) {
      n++
      const text = '第' + c + '份 记忆' + id + ' 的内容'
      points.push({ id: n, title: '记忆' + id + '-' + c, text, born: now - (id * 1000) - c * 60000 })
      if (n > omit) vecs[String(n)] = { h: VX.fpOf({ title: '记忆' + id + '-' + c, text }), v: Array.from(src.get(id)) }
    }
  }
  writeSea(sea, { version: 3, points, edges: [] })
  mkdirSync(join(SEAS_DIR, sea), { recursive: true })
  writeFileSync(join(SEAS_DIR, sea, 'vectors.json'), JSON.stringify(vecs), 'utf8')
  return n
}

async function coldStart(sea) {
  const code = `
process.env.USERPROFILE = ${JSON.stringify(home)}
process.env.HOME = ${JSON.stringify(home)}
const LIB = ${JSON.stringify(LIB)}
const t0 = Date.now()
const { searchTool } = await import(LIB + '/tools.js')
await searchTool.execute({ query: '记忆 内容', limit: 3, review: false })
console.log(JSON.stringify({ ms: Date.now() - t0 }))
`
  const file = join(home, 'cold.mjs')
  writeFileSync(file, code, 'utf8')
  return new Promise((resolve) => {
    const t = Date.now()
    const p = spawn(_nodeBin, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (c) => { out += c })
    p.stderr.on('data', (c) => { out += c })
    p.on('close', () => {
      const m = String(out).match(/\{.*\}/)
      resolve(m ? JSON.parse(m[0]).ms : Date.now() - t)
    })
  })
}

async function run(sea, mult) {
  const n = build(sea, mult, 100)
  const { searchTool } = await import(LIB + '/tools.js' + Q)

  const cold = await coldStart(sea)

  const seq = []
  for (let i = 0; i < 30; i++) {
    const t = Date.now()
    await searchTool.execute({ query: '记忆' + (i + 1) + ' 内容', limit: 5, review: false })
    seq.push(Date.now() - t)
  }

  const par = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const t = Date.now()
    await searchTool.execute({ query: '记忆' + (i + 2) + ' 内容', limit: 5, review: false })
    return Date.now() - t
  }))

  const d = readSea(sea)
  const t3 = Date.now()
  const filled = await V.backfillVectors(sea, d, { batch: 100, budgetMs: 180000 })
  const fillMs = Date.now() - t3

  // 2026-11-21：以前「每条多少毫秒」除的是原始回执（多半是个对象），除出来是 NaN。
  // 先把条数算成一个数，两条都用它。
  const fillN = Number(filled && (filled.filled ?? filled.count ?? filled.n ?? filled)) || 0
  return {
    n,
    cold,
    seq50: pct(seq, 0.5),
    seq95: pct(seq, 0.95),
    par95: pct(par, 0.95),
    fillN,
    fillMs,
    fillPer: fillN ? (fillMs / fillN).toFixed(1) : '0',
  }
}

const rows = []
for (const m of mults) rows.push(await run('scale' + m, m))

for (const r of rows) {
  console.log(`\n${r.n} 条（${Math.round(r.n / ids.length)}×）`)
  console.log(`  冷启动（新进程读库+首问）：${r.cold}ms`)
  console.log(`  检索 30 问：p50 ${r.seq50}ms · p95 ${r.seq95}ms`)
  console.log(`  并发 8 问：p95 ${r.par95}ms`)
  console.log(`  补齐：${r.fillN} 条 / ${r.fillMs}ms = ${r.fillPer}ms 一条`)
}
