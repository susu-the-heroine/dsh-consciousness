/**
 * 向量补齐：一次补到底
 * ====================
 *
 *   node scripts/test-vector-backfill.mjs
 *
 * 用户反馈（2026-11-18）：老条目一次只补两条，两百多条要上百次搜索才追平。
 * 改完之后：开窗口空闲时批处理补，另给一个入口手动催。
 * 这条测两件事——缺口数得对、一次能补到零。
 */
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-vec-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

// 2026-11-21：以前按当前目录找库，换个目录跑就 file:///C:/lib，一上来就断。改成按本文件位置算。
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')
const { vectorGap, backfillVectors } = await import(LIB + '/vectors.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

// 三十条：模拟「库里有存量、向量一条没有」
const points = []
for (let i = 1; i <= 30; i++) {
  points.push({
    id: i,
    title: '第' + i + '件事：关于老周和那台相机的记性',
    text: '这是第' + i + '条记忆的正文，讲的是老周搬走那天把相机落在门口的事，天气很冷，后来再没找回来。',
    born: Date.now() - i * 86400000,
  })
}
writeSea('main', { version: 3, points, edges: [] })
const data = await import(LIB + '/store.js').then((m) => m.readSea('main'))

const g0 = vectorGap('main', data)
ok('缺口数得出来：三十条全缺', g0.need === 30 && g0.have === 0, JSON.stringify(g0))

const t0 = Date.now()
const r = await backfillVectors('main', data, { batch: 20, budgetMs: 180000 })
const ms = Date.now() - t0
ok('一次补到底：剩零条', r.remaining === 0, JSON.stringify(r))
ok('填了三十条', r.filled === 30, JSON.stringify(r))
ok('补完再数一遍：不缺了', vectorGap('main', data).need === 0)
const vp = join(SEAS_DIR, 'main', 'vectors.json')
const raw = existsSync(vp) ? JSON.parse(readFileSync(vp, 'utf8')) : {}
ok('向量文件里真有三十条', Object.keys(raw).length === 30, String(Object.keys(raw).length))
ok('每条都带维度数', Object.values(raw).every((o) => Array.isArray(o.v) && o.v.length > 8))

// 反例：空库不该报错、也不该空转
writeSea('empty', { version: 3, points: [], edges: [] })
const ed = await import(LIB + '/store.js').then((m) => m.readSea('empty'))
const r2 = await backfillVectors('empty', ed, { batch: 20, budgetMs: 3000 })
ok('空库：不报错、填零', r2.filled === 0 && r2.remaining === 0, JSON.stringify(r2))

/* ---------- 模型版本化：换模型 = 全体陈旧 ---------- */
{
  const idxFile = join(SEAS_DIR, 'main', 'vectors.idx.json')
  const idx = JSON.parse(readFileSync(idxFile, 'utf8'))
  const old = { ...idx, model: 'BAAI/bge-small-zh-v1.5-fp32', dim: 384 }
  writeFileSync(idxFile, JSON.stringify(old), 'utf8')
  const g = vectorGap('main', data)
  ok('换过模型的账本：整本作废（全缺）', g.need === 30 && g.have === 0, JSON.stringify(g))
  const r3 = await backfillVectors('main', data, { batch: 20, budgetMs: 60000 })
  ok('重建后不缺', r3.remaining === 0 && vectorGap('main', data).need === 0, JSON.stringify(r3))
}

/* ---------- 队列：算不出来就排着，别丢 ---------- */
{
  const VX = await import(LIB + '/vecidx.js')
  VX.queueAdd('main', [999, 888])
  ok('队列记得住', VX.queueRead('main').length === 2, JSON.stringify(VX.queueRead('main')))
  VX.queueDrop('main', [999])
  ok('出队只掉指定的', VX.queueRead('main').length === 1 && VX.queueRead('main')[0] === 888)
  VX.queueDrop('main', [888])
  ok('清空', VX.queueRead('main').length === 0)
}

/* ---------- 健康度 ---------- */
{
  const V = await import(LIB + '/vectors.js')
  const h = V.vectorHealth('main', data)
  ok('健康度：覆盖率一百', h.coverage === 100, JSON.stringify(h))
  ok('健康度：陈旧零', h.stale === 0 && h.missing === 0)
  ok('健康度：报得出模型与维度', h.model && h.dim === 512, JSON.stringify({ m: h.model, d: h.dim }))
  ok('健康度：p95 有数', typeof h.p95_ms === 'number' && h.p95_ms >= 0)
}

/* ---------- 紧凑存储：二进制与 JSON 对得上 ---------- */
{
  const V = await import(LIB + '/vectors.js')
  const VX = await import(LIB + '/vecidx.js')
  const map = V.loadVectors('main')
  ok('读得出三十条', map.size === 30, String(map.size))
  ok('二进制已产生', VX.binBytes('main') > 0, String(VX.binBytes('main')))
  const raw = JSON.parse(readFileSync(join(SEAS_DIR, 'main', 'vectors.json'), 'utf8'))
  let maxDiff = 0
  for (const [id, v] of map) {
    const w = raw[id] && raw[id].v
    if (!w) { maxDiff = 999; break }
    for (let i = 0; i < v.length; i++) maxDiff = Math.max(maxDiff, Math.abs(v[i] - w[i]))
  }
  ok('二进制与 JSON 数值一致', maxDiff < 1e-6, String(maxDiff))
  const one = VX.readVector('main', 3)
  ok('按 id 单读一条', !!one && one.length === 512, one ? String(one.length) : 'null')
}

/* ---------- 迁移：只有 JSON 的老库，第一次读就写二进制 ---------- */
{
  const V = await import(LIB + '/vectors.js')
  const VX = await import(LIB + '/vecidx.js')
  V.clearVectorCache('main')
  const old = { '1': { h: 'x', v: new Array(512).fill(0.01) }, '2': { h: 'y', v: new Array(512).fill(0.02) } }
  writeFileSync(join(SEAS_DIR, 'main', 'vectors.json'), JSON.stringify(old), 'utf8')
  // 模拟老库：把二进制和账本清掉
  const bin = join(SEAS_DIR, 'main', 'vectors.bin')
  const idx = join(SEAS_DIR, 'main', 'vectors.idx.json')
  try { (await import('node:fs')).unlinkSync(bin) } catch {}
  try { (await import('node:fs')).unlinkSync(idx) } catch {}
  const m = V.loadVectors('main')
  ok('老库迁移后读得出两条', m.size === 2, String(m.size))
  ok('迁移写出二进制', VX.binBytes('main') > 0, String(VX.binBytes('main')))
}

console.log(`\n向量补齐自测：通过 ${pass} · 失败 ${fail} · 30 条耗时 ${(ms / 1000).toFixed(1)} 秒`)
process.exit(fail ? 1 : 0)
