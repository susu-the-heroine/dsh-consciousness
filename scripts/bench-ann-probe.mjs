/**
 * 探针比例扫描
 * ============
 *
 *   node scripts/bench-ann-probe.mjs
 *
 * 四千条合成向量，扫几个候选比例，看「候选多少条」和「前五还全不全」。
 * 只跑沙箱，跑完自己删。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：两处都按当前目录找库——换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB0 = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
// 真库的向量要在切沙箱之前读，切完就读不到了
let realVecs = null
try {
  const _v = await import(LIB0 + '/vectors.js')
  const m = _v.loadVectors('main')
  realVecs = [...m.values()].filter((x) => x && x.length)
} catch {}

const home = mkdtempSync(join(tmpdir(), 'sea-probe-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = LIB0
const { SEAS_DIR } = await import(LIB + '/paths.js')
const VX = await import(LIB + '/vecstore.js')
const { loadVectors } = await import(LIB + '/vectors.js')
const ann = await import(LIB + '/ann.js')

const N = Number(process.argv[2]) || 4000
const sea = 'probe'
mkdirSync(join(SEAS_DIR, sea), { recursive: true })

const ent = []
const vecs = []
const useReal = process.argv.includes("--real")
if (useReal) {
  // 拿真库的向量复制二十份、每份加一点噪声：比正弦波难，才试得出探针比例
  const src = realVecs || []
  if (!src.length) { console.log('真库没有向量，先跑一次检索'); process.exit(1) }
  let id = 1
  for (let c = 0; c < 20; c++) {
    for (const base of src) {
      const v = new Float32Array(512)
      let n2 = 0
      for (let k = 0; k < 512; k++) { v[k] = base[k] + (Math.random() - 0.5) * 0.12 }
      for (let k = 0; k < 512; k++) n2 += v[k] * v[k]
      const d = Math.sqrt(n2) || 1
      for (let k = 0; k < 512; k++) v[k] /= d
      ent.push({ id, v, h: 'r' + id })
      vecs.push(v)
      id++
    }
  }
} else {
  for (let i = 1; i <= N; i++) {
    const v = new Float32Array(512)
    for (let k = 0; k < 512; k++) v[k] = Math.sin(i * 0.013 + k * 0.29) + Math.cos(i * 0.007 * (1 + (k % 7)))
    ent.push({ id: i, v, h: 'p' + i })
    vecs.push(v)
  }
}
VX.putMany(sea, ent)
const vmap = loadVectors(sea)
ann.build(sea, vmap)

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const probes = []
for (let q = 0; q < 30; q++) {
  if (useReal && realVecs && realVecs.length) {
    // 真实问句的样子：拿库里的向量加一点噪声，比随机向量合理
    const base = realVecs[Math.floor((q / 30) * realVecs.length)]
    const v = new Float32Array(512)
    let n2 = 0
    for (let k = 0; k < 512; k++) v[k] = base[k] + (Math.random() - 0.5) * 0.06
    for (let k = 0; k < 512; k++) n2 += v[k] * v[k]
    const d = Math.sqrt(n2) || 1
    for (let k = 0; k < 512; k++) v[k] /= d
    probes.push(v)
  } else {
    const v = new Float32Array(512)
    for (let k = 0; k < 512; k++) v[k] = Math.sin((q + 1) * 0.31 + k * 0.19) + Math.cos(q * 0.11 + k * 0.05)
    probes.push(v)
  }
}

for (const ratio of [0.06, 0.1, 0.12, 0.2, 0.3, 0.5]) {
  process.env.C2_ANN_PROBE = String(ratio)
  let candSum = 0
  let hit5 = 0
  let hit10 = 0
  for (const q of probes) {
    const ids = [...ann.probe(sea, q, vmap)]
    candSum += ids.length
    const truth = vecs.map((v, i) => [dot(q, v), i + 1]).sort((a, b) => b[0] - a[0]).slice(0, 10).map((x) => x[1])
    const set = new Set(ids)
    if (truth.slice(0, 5).every((id) => set.has(id))) hit5++
    if (truth.every((id) => set.has(id))) hit10++
  }
  console.log(`比例 ${ratio}：候选均 ${Math.round(candSum / probes.length)} 条 · 前五全在 ${Math.round((hit5 / probes.length) * 100)}% · 前十全在 ${Math.round((hit10 / probes.length) * 100)}%`)
}

try { rmSync(join(SEAS_DIR, sea), { recursive: true, force: true }) } catch {}
process.exit(0)
