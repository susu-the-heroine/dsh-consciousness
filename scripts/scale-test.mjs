/**
 * 规模压测（沙箱跑，不碰他的库）
 * ============================
 *
 *   node scripts/scale-test.mjs [--n 2000] [--q 100] [--w 30]
 *
 * 做三件事：
 *   1) 建一个临时 HOME，造 N 条假记忆直接落盘（快，绕过写入管线）
 *   2) 用真正的检索工具跑 Q 条查询，量 p50 / p95 / 最慢
 *   3) 用真正的写入工具写 W 条，量单条写入耗时
 *
 * 输出 scripts/data/scale-report.json。全程在临时目录，跑完删掉。
 */
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库按当前目录找、报告也写当前目录——换个目录跑，一上来就断；
// 而且报告是在打印之前写的，断在那儿连一行数都看不到。都改成按本文件位置算。
const HERE = dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const num = (name, d) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
}
const N = num('n', 2000)
const Q = num('q', 100)
const W = num('w', 30)

// 先把 HOME 指到沙箱，再 import 任何 lib——paths.js 在 import 时就定死了目录
const HOME = mkdtempSync(join(tmpdir(), 'sea-scale-'))
process.env.USERPROFILE = HOME
process.env.HOME = HOME
mkdirSync(join(HOME, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea, readSea, seaPath } = await import(LIB + '/store.js')
const { searchTool, addTool } = await import(LIB + '/tools.js')

// ---- 造假记忆：句式像人话，主题乱撒 ----
const SUBJ = ['那个脚本', '楼下那家店', '他的车', '上次那个包', '我妈生日', '键盘', '台风天', '那条视频', '朋友', '快递']
const VERB = ['跑通了', '被我弄坏了', '改了三次', '一直没修', '说好了要换', '又忘了', '突然崩了', '重装了一遍', '没敢动', '还在路上']
const TAIL = ['记得别声张', '回头补个记录', '这事先放着', '等有空再说', '别跟他提', '明天再看', '就这样吧', '']
const QUERIES = ['脚本为啥崩了', '那家店叫什么', '我妈生日是哪天', '车的事后来怎么定的', '键盘换了吗', '视频跑通没有', '快递到哪了', '朋友最后怎么说的']

const rnd = (n) => Math.floor(Math.random() * n)
const now = Date.now()
const points = []
for (let i = 0; i < N; i++) {
  const title = `${SUBJ[rnd(SUBJ.length)]}${VERB[rnd(VERB.length)]}`
  const text = `${title}。${SUBJ[rnd(SUBJ.length)]}${VERB[rnd(VERB.length)]}，${TAIL[rnd(TAIL.length)]}。第 ${i} 条。`
  points.push({
    id: 'p' + (i + 1),
    title,
    text,
    t: now - rnd(90) * 86400000,
    imp: 0.3 + Math.random() * 0.6,
    emo: rnd(3) - 1,
    archive: 0,
  })
}

const t0 = Date.now()
writeSea('main', { version: 3, points, edges: [] })
const diskMs = Date.now() - t0

// ---- 读一次，确认真落了 ----
const back = readSea('main')
const okCount = (back && back.points || []).length

// ---- 检索 ----
const lat = []
let fails = 0
for (let i = 0; i < Q; i++) {
  const q = QUERIES[i % QUERIES.length]
  const s = Date.now()
  try {
    const r = await searchTool.execute({ query: q, sea: 'main', limit: 6, review: false })
    if (!r || r.ok === false) fails++
  } catch { fails++ }
  lat.push(Date.now() - s)
}
lat.sort((a, b) => a - b)
const pick = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]

// ---- 写入 ----
const wlat = []
for (let i = 0; i < W; i++) {
  const s = Date.now()
  try {
    await addTool.execute({ title: `压测写入 ${i}`, text: `这是第 ${i} 条压测写入，用来量单条耗时。`, sea: 'main' })
  } catch {}
  wlat.push(Date.now() - s)
}
wlat.sort((a, b) => a - b)
const wpick = (p) => wlat[Math.min(wlat.length - 1, Math.floor(wlat.length * p))]

const report = {
  at: new Date().toISOString(),
  points: okCount,
  diskWriteMs: diskMs,
  search: { n: Q, fails, p50: pick(0.5), p95: pick(0.95), max: lat[lat.length - 1] },
  write: { n: W, p50: wpick(0.5), p95: wpick(0.95), max: wlat[wlat.length - 1] },
  dataFileBytes: 0,
}
try {
  const { statSync } = await import('node:fs')
  report.dataFileBytes = statSync(seaPath('main')).size
} catch {}

try {
  const outDir = join(HERE, 'data')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'scale-report.json'), JSON.stringify(report, null, 1))
} catch (e) {
  // 报告写不进去不该把这次压测白跑——数照样打在屏幕上。
  console.log('报告没写进去：' + String((e && e.message) || e).slice(0, 80))
}
console.log(`落盘 ${okCount} 条 / ${diskMs}ms`)
console.log(`检索 ${Q} 次：失败 ${fails} · p50 ${report.search.p50}ms · p95 ${report.search.p95}ms · 最慢 ${report.search.max}ms`)
console.log(`写入 ${W} 条：p50 ${report.write.p50}ms · p95 ${report.write.p95}ms · 最慢 ${report.write.max}ms`)
console.log(`库文件 ${(report.dataFileBytes / 1048576).toFixed(2)} MB`)

// 收尾：先关掉候选层（sqlite 句柄），再删临时目录；删不掉不算失败
try {
  const { closeCandidates } = await import(LIB + '/candidates.js')
  closeCandidates()
} catch {}
for (let i = 0; i < 3; i++) {
  try { rmSync(HOME, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 300)) }
}
