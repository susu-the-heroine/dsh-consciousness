/**
 * 规模与坏库恢复
 * ==============
 *
 * 一、连写 N 条，量每条耗时与文件体积——回答"写多了会不会卡"。
 * 二、故意把 data.json 弄坏，看读库会不会炸、备份能不能救回来。
 *
 * 跑法：node scripts/scale-and-recovery-test.mjs [条数]
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const N = Number(process.argv[2] || 300)
const home = mkdtempSync(join(tmpdir(), 'scale-'))
process.env.USERPROFILE = home
process.env.HOME = home

const W = await import('file:///' + join(HERE, '..', 'lib', 'write-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

// ── 一、连写
const times = []
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint()
  W.writeOne('main', {
    title: `规模-${i}`,
    text: `第 ${i} 条。写的是不同内容，用来测写入随条数增长的变化。序号 ${i}，不重复。`,
    kind: i % 3 === 0 ? 'feeling' : 'fact',
  })
  times.push(Number(process.hrtime.bigint() - t0) / 1e6)
}
const sorted = [...times].sort((a, b) => a - b)
const p = (q) => Math.round(sorted[Math.floor(sorted.length * q)] * 10) / 10
const sea = join(home, '.dsh', 'consciousness-seas', 'main')
const dataFile = join(sea, 'data.json')
const size = existsSync(dataFile) ? readFileSync(dataFile).length : 0

const d = S.readSea('main')
console.log(`写了 ${N} 条 · 文件 ${(size / 1024).toFixed(0)} KB · 突触 ${(d.edges || []).length}`)
console.log(`每条耗时：前 10 条 ${Math.round(times[0] * 10) / 10}ms → 最后 10 条 ${Math.round(times[times.length - 1] * 10) / 10}ms`)
console.log(`分位：p50 ${p(0.5)}ms · p95 ${p(0.95)}ms · 最慢 ${Math.round(sorted[sorted.length - 1] * 10) / 10}ms`)

const t0 = process.hrtime.bigint()
const again = S.readSea('main')
const readMs = Number(process.hrtime.bigint() - t0) / 1e6
console.log(`读整库 ${Math.round(readMs * 10) / 10}ms`)

ok(`一条不丢（${N} 条）`, (again.points || []).length === N, '实际 ' + (again.points || []).length)
ok('写入耗时没失控（p95 < 2000ms）', p(0.95) < 2000, 'p95 ' + p(0.95) + 'ms')
ok('读库不慢（< 500ms）', readMs < 500, Math.round(readMs) + 'ms')

// ── 二、坏库恢复
const bakDir = join(home, '.dsh', 'consciousness-backups', 'main')
const baks = existsSync(bakDir) ? readdirSync(bakDir).sort() : []
ok('备份攒下了', baks.length > 0, '份数 ' + baks.length)

// 弄坏：截掉一半
const raw = readFileSync(dataFile, 'utf8')
writeFileSync(dataFile, raw.slice(0, Math.floor(raw.length / 2)), 'utf8')
const brokenRead = S.readSea('main')
ok('坏库读出来是 null，不抛错', brokenRead === null, String(brokenRead === null))

// 用最新备份救回来
const latest = baks[baks.length - 1]
copyFileSync(join(bakDir, latest), dataFile)
const revived = S.readSea('main')
ok('用备份能救回来', !!revived && (revived.points || []).length > 0, '救回 ' + ((revived && revived.points || []).length) + ' 条')

// 空文件也该是 null，不是炸
writeFileSync(dataFile, '', 'utf8')
ok('空文件读出来是 null', S.readSea('main') === null)

rmSync(home, { recursive: true, force: true })
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
