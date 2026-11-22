/**
 * 检索规模基线
 * ============
 *
 *   node scripts/bench-ann.mjs [N...]
 *
 * 只量「全量向量挨个算」这一段：读向量 + 一万次 cosine。
 * 这是上 ANN 之前的地板，也是上完之后的对照。
 * 用随机向量，不调模型——量的是复杂度，不是召回。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const sizes = (process.argv.slice(2).map(Number).filter((x) => x > 0))
const list = sizes.length ? sizes : [1000, 5000, 10000]

const home = mkdtempSync(join(tmpdir(), 'sea-bench-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea, readSea } = await import(LIB + '/store.js')
const V = await import(LIB + '/vectors.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')
const { join: j } = await import('node:path')

const randVec = () => {
  const a = new Float32Array(512)
  let n = 0
  for (let i = 0; i < 512; i++) { a[i] = Math.random() * 2 - 1; n += a[i] * a[i] }
  const d = Math.sqrt(n) || 1
  for (let i = 0; i < 512; i++) a[i] /= d
  return a
}

for (const N of list) {
  const sea = 'bench' + N
  const points = []
  const vecs = {}
  for (let i = 1; i <= N; i++) {
    points.push({ id: i, title: '记忆 ' + i, text: '正文 ' + i, born: Date.now() - i * 1000 })
    vecs[String(i)] = { h: String(i), v: Array.from(randVec()) }
  }
  writeSea(sea, { version: 3, points, edges: [] })
  writeFileSync(j(SEAS_DIR, sea, 'vectors.json'), JSON.stringify(vecs), 'utf8')

  const ann = await import(LIB + '/ann.js')
  const q = randVec()
  const full = []
  const annMs = []
  let candN = 0
  for (let k = 0; k < 6; k++) {
    V.clearVectorCache(sea)
    const t1 = Date.now()
    const map = V.loadVectors(sea)
    for (const v of map.values()) V.cosine(q, v)
    full.push(Date.now() - t1)

    const t2 = Date.now()
    const cand = ann.probe(sea, q, map)
    candN = cand.size
    for (const id of cand) {
      const v = map.get(id)
      if (v) V.cosine(q, v)
    }
    annMs.push(Date.now() - t2)
  }
  const stat = (arr) => {
    const x = [...arr].sort((a, b) => a - b)
    return {
      p50: x[Math.floor(x.length / 2)],
      p95: x[Math.min(x.length - 1, Math.floor(x.length * 0.95))],
    }
  }
  const f = stat(full)
  const g = stat(annMs)
  const mem = (process.memoryUsage().heapUsed / 1048576).toFixed(0)
  console.log(`${N} 条：全扫 p95 ${f.p95}ms（p50 ${f.p50}）→ 粗筛 p95 ${g.p95}ms（p50 ${g.p50}）· 候选 ${candN} 条 · 堆 ${mem}MB`)
}

console.log('\n基线量完。目标：一万条 p95 ≤ 50ms。')
