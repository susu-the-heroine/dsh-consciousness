/**
 * IVF 召回（用真向量造的规模）
 * ============================
 *   node scripts/bench-ann-recall.mjs [副本倍数]
 *
 * 随机向量没有语义团簇，拿它测 IVF 召回必然是零——那是题出错了，不是方法错。
 * 这里从主海取真实向量，每条加一点噪声复制 N 份，把量做上去；
 * 查询用真实向量，看真前十名有几条落在候选里。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const COPIES = Number(process.argv[2] || 20)

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const V = await import(LIB + '/vectors.js')
const ann = await import(LIB + '/ann.js')

// 2026-11-21：这行读了主库却从没用过（只用向量）。删掉，省一次全库读。
const base = V.loadVectors('main')
const ids = [...base.keys()]
if (!ids.length) { console.log('主海没有向量，先跑一次检索或补齐再测'); process.exit(1) }

const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const noise = (v, sigma) => {
  const a = Float32Array.from(v)
  for (let i = 0; i < a.length; i++) a[i] += (Math.random() - 0.5) * 2 * sigma
  let n = 0
  for (let i = 0; i < a.length; i++) n += a[i] * a[i]
  const d = Math.sqrt(n) || 1
  for (let i = 0; i < a.length; i++) a[i] /= d
  return a
}

const vmap = new Map()
let nid = 1
for (let c = 0; c < COPIES; c++) {
  for (const id of ids) {
    const v = c === 0 ? base.get(id) : noise(base.get(id), 0.08)
    vmap.set(nid++, v)
  }
}

const t0 = Date.now()
ann.build('bench', vmap)
const buildMs = Date.now() - t0
const st = ann.stats('bench')

const Q = Math.min(60, ids.length)
let hit5 = 0
let hit10 = 0
let candSum = 0
const lat = []
for (let k = 0; k < Q; k++) {
  const q = base.get(ids[k])
  const truth = []
  for (const [id, v] of vmap) truth.push([cos(q, v), id])
  truth.sort((a, b) => b[0] - a[0])
  const top5 = truth.slice(0, 5).map((x) => x[1])
  const top10 = truth.slice(0, 10).map((x) => x[1])
  const t1 = Date.now()
  const cand = ann.probe('bench', q, vmap)
  for (const id of cand) { const v = vmap.get(id); if (v) cos(q, v) }
  lat.push(Date.now() - t1)
  candSum += cand.size
  if (top5.every((id) => cand.has(id))) hit5++
  if (top10.every((id) => cand.has(id))) hit10++
}
lat.sort((a, b) => a - b)
console.log(`规模 ${vmap.size} 条（真向量 ×${COPIES}）· 建索引 ${buildMs}ms · k=${st.k}`)
console.log(`候选均 ${(candSum / Q).toFixed(0)} 条 · 前五全在 ${(hit5 / Q * 100).toFixed(1)}% · 前十全在 ${(hit10 / Q * 100).toFixed(1)}%`)
console.log(`粗筛延迟 p50 ${lat[Math.floor(lat.length / 2)]}ms · p95 ${lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]}ms`)

// 跑完把自己造的临时海删掉：测试只碰沙箱，别在真库里留东西（2026-11-19）
try {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const b = path.join(os.homedir(), '.dsh', 'consciousness-seas', 'bench')
  if (fs.existsSync(b)) fs.rmSync(b, { recursive: true, force: true })
} catch {}
