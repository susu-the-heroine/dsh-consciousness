/**
 * 查询合并器自测
 * ==============
 *   node scripts/test-qbatch.mjs
 *
 * 八条不同问句同时来：合成一批算完，p95 进一百毫秒；同句第二次直接吃缓存。
 * 先热一轮（JIT/内存池），再量第二轮——冷启动不混进并发里。
 */
// 2026-11-21：同一类毛病——库里那份自测也写死了本机绝对路径（带用户名）。
// 换台机器直接引不进来。改成按本文件位置算。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB = 'file:///' + join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'qbatch.js').replace(/\\/g, '/')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const QB = await import(LIB)

async function round(tag) {
  const lat = []
  const jobs = []
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now()
    const txt = tag + '第' + i + '个问题：那件事后来怎么样了'
    jobs.push(QB.embedMerged(txt).then((v) => {
      lat.push(Date.now() - t0)
      return v
    }))
  }
  const vs = await Promise.all(jobs)
  return { vs, lat }
}

// 热一轮
await round('热身')
await new Promise((r) => setTimeout(r, 50))

const { vs, lat } = await round('正式')
ok('八条都算出来了', vs.every((v) => v && v.length === 512), vs.map((v) => (v ? v.length : 0)).join(','))

lat.sort((a, b) => a - b)
const p95 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]
console.log('  · p95 = ' + p95 + 'ms')
ok('并发 p95 进一百毫秒', p95 < 100, p95 + 'ms（各条 ' + lat.join('/') + '）')

const t1 = Date.now()
const again = await QB.embedMerged('正式第0个问题：那件事后来怎么样了')
ok('同句走缓存', !!again && Date.now() - t1 < 15, (Date.now() - t1) + 'ms')

console.log(`\n查询合并自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
