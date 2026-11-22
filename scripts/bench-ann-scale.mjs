/**
 * 建索引的规模曲线
 * ================
 *   node scripts/bench-ann-scale.mjs [n1 n2 ...]
 *
 * 只量「从零聚出簇并归队」这一段。落到盘上之后的读取另有测试。
 */
import { rmSync } from 'node:fs'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'sea-annscale-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

// 2026-11-21：按当前目录拼库，换个目录跑就断；改成按本文件位置算。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const VX = await import(LIB + '/vecstore.js')
const { loadVectors } = await import(LIB + '/vectors.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')

const sizes = process.argv.slice(2).map(Number).filter((x) => x > 0)
const list = sizes.length ? sizes : [2000, 5000]

const out = []
for (const n of list) {
  const sea = 's' + n
  mkdirSync(join(SEAS_DIR, sea), { recursive: true })
  const ent = []
  for (let i = 1; i <= n; i++) {
    const v = new Float32Array(512)
    for (let k = 0; k < 512; k++) v[k] = Math.sin(i * 0.017 + k * 0.31)
    ent.push({ id: i, v, h: 'h' + i })
  }
  VX.putMany(sea, ent)
  const vmap = loadVectors(sea)
  const ann = await import(LIB + '/ann.js?n=' + n)
  const t0 = Date.now()
  const box = ann.build(sea, vmap)
  const ms = Date.now() - t0
  out.push({ n, k: box.k, ms, per: Math.round((ms / n) * 1000) / 1000 })
  console.log(`${n} 条：k=${box.k} · 建索引 ${ms}ms`)
}

// 按每条的线性成本外推十万条（归队是线性的，重聚只吃 512 条样本）
const last = out[out.length - 1]
if (last) {
  const perOp = last.ms / (last.n * last.k)
  const annMod = await import(LIB + '/ann.js')
  const k100 = annMod.planK(100000)
  const predict = Math.round(perOp * 100000 * k100)
  console.log("外推十万条：约 " + predict + "ms（k=" + k100 + "，按实测每次乘加成本）")
}
// 自己造的壳自己收：别把测试海留在真库里
// 2026-11-21：原来只收最后一个海，前面几档全留在地上；临时家目录也没人删。
// 实测跑两档之后临时区里积了十七个 sea-annscale-*。改成逐档收，再收临时家。
for (const n of list) {
  try { rmSync(join(SEAS_DIR, 's' + n), { recursive: true, force: true }) } catch {}
}
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(0)
