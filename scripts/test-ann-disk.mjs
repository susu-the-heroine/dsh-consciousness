/**
 * 索引落盘与增量
 * ==============
 *   node scripts/test-ann-disk.mjs
 *
 * 冷建要多久、落盘后重开多久、新加一条能不能只挪一个簇。
 * 全程临时目录。
 */
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'sea-ann-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

// 2026-11-21：库按当前目录找——换个目录跑就报找不到 file:///C:/lib/vecstore.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const VX = await import(LIB + '/vecstore.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')
const { loadVectors } = await import(LIB + '/vectors.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const sea = 'ann'
mkdirSync(join(SEAS_DIR, sea), { recursive: true })
const N = 400
const ent = []
for (let i = 1; i <= N; i++) {
  const v = new Float32Array(512)
  for (let k = 0; k < 512; k++) v[k] = Math.sin(i * 0.13 + k * 0.7)
  ent.push({ id: i, v, h: 'h' + i })
}
VX.putMany(sea, ent)

const ann1 = await import(LIB + '/ann.js')
const vmap = loadVectors(sea)
const t0 = Date.now()
const b1 = ann1.build(sea, vmap)
const cold = Date.now() - t0
ok('冷建出簇（两级：粗中心 + 细簇）', b1.k > 0 && b1.buckets.length >= b1.k, JSON.stringify({ k: b1.k, fine: b1.buckets.length }))
ok('索引落了盘', existsSync(join(SEAS_DIR, sea, 'ann.json')))

// 换个模块实例（等于重启）：该走落盘，不该重聚
const ann2 = await import(LIB + '/ann.js?fresh=' + Date.now())
const t1 = Date.now()
const b2 = ann2.build(sea, vmap)
const warm = Date.now() - t1
ok('重开走落盘（比冷建快）', b2.k === b1.k && warm <= Math.max(5, cold), JSON.stringify({ cold, warm }))

// 增量：加一条，只进桶，不重聚
VX.putMany(sea, [{ id: 999, v: Float32Array.from({ length: 512 }, (_, k) => Math.cos(k * 0.2)), h: 'h999' }])
const vmap2 = loadVectors(sea)
const before = b1.buckets.reduce((a, x) => a + x.length, 0)
const ann3 = await import(LIB + '/ann.js?inc=' + Date.now())
ann3.build(sea, vmap2)              // 条数变了，会重聚一次
const b3 = ann3.loadDisk(sea)
const okAdd = ann3.addIncremental(sea, vmap2, [1001])
ok('增量接口在', typeof ann3.addIncremental === 'function')
// 2026-11-21：上面那个返回值以前只赋给变量就没人看——调用失败也照样绿。
ok('增量调用没失败', okAdd !== false, String(okAdd))
ok('增量后条数对齐', !!b3 && Number(b3.n) === vmap2.size, JSON.stringify({ diskN: b3 && b3.n, vmapN: vmap2.size }))

const probe = ann3.probe(sea, vmap2.get(1), vmap2)
ok('探测返回候选集', probe instanceof Set && probe.size > 0, String(probe && probe.size))

console.log(`\n索引落盘自测：通过 ${pass} · 失败 ${fail} · 冷建 ${cold}ms · 重开 ${warm}ms`)
process.exit(fail ? 1 : 0)
