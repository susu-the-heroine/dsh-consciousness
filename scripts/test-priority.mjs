/**
 * 优先级闸自测
 * ============
 *   node scripts/test-priority.mjs
 *
 * 六路前台 + 三十个后台补库同时排队：前台必须全部先过完。
 * 只排顺序，不改结果。
 */
// 2026-11-21：这里原来写死了一条本机绝对路径（C:/Users/Administrator/...）——
// 换台机器、换个用户名，这份自测连模块都引不进来。改成按本文件位置算。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB = 'file:///' + join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'priority.js').replace(/\\/g, '/')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const P = await import(LIB)
P.reset()
const order = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const highs = []
for (let i = 0; i < 6; i++) {
  highs.push(P.high(async () => { await sleep(30); order.push('H' + i) }))
}
const lows = []
for (let i = 0; i < 30; i++) {
  lows.push(P.low(async () => { await sleep(5); order.push('L' + i) }))
}

const timeout = new Promise((r) => setTimeout(() => r('timeout'), 8000))
const done = await Promise.race([Promise.all([...highs, ...lows]).then(() => 'ok'), timeout])
ok('不死锁，全跑完', done === 'ok', String(done))

const lastHigh = order.lastIndexOf('H5')
const firstLow = order.indexOf('L0')
ok('前台都排在后台前面', lastHigh < firstLow, order.slice(0, 8).join(','))

const pend = P.pending()
ok('跑完队列清空', pend.busy === false && pend.queued === 0, JSON.stringify(pend))

// 低优先之间保持先来先走
P.reset()
const seq = []
for (let i = 0; i < 5; i++) P.low(async () => { seq.push(i) })
await Promise.all([P.low(async () => {}), sleep(180)])
ok('低优先按顺序走', seq.slice(0, 4).join(',') === '0,1,2,3', seq.join(','))

console.log(`\n优先级闸自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
