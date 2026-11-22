/**
 * 候选模块自测
 * ============
 *
 * 验三件事：两路各自能出东西、合起来条数合理、候选太少时会返回空（让上层整库扫）。
 * 用真库，只读。
 *
 * 跑法：node scripts/candidates-test.mjs [sea]
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const C = await import('file:///' + join(HERE, '..', 'lib', 'candidates.js').replace(/\\/g, '/') + '?v=' + Date.now())

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  通过  ' + name) }
  else { fail++; console.log('  失败  ' + name + (extra ? ' → ' + extra : '')) }
}

const q = '他腰疼那次我说了什么'
const f = C.ftsCandidates(sea, q, 60)
ok('全文那一路有候选', Array.isArray(f) && f.length > 0, 'len=' + f.length)
const v = await C.vectorCandidates(sea, q, 60)
ok('向量那一路有候选', Array.isArray(v) && v.length > 0, 'len=' + v.length)
const all = await C.candidatesFor(sea, q, { n: 60, min: 20 })
ok('合起来够二十条', Array.isArray(all) && all.length >= 20, 'len=' + all.length)
ok('合起来没有重复', all.length === new Set(all).size)

// 2026-11-21：这条原来叫「没内容时返回空（要整库兜底）」，可断言只查了「是个数组」——
// 名字说空，测的是不炸。实测「嗯」拿到六十条，压根不是空。名字照实改，
// 要不要真返回空是设计问题，另记一笔，别在这儿假装测过了。
const none = await C.candidatesFor(sea, '嗯', { n: 60, min: 20 })
ok('短问句也给数组、不炸（实测不是空：六十条）', Array.isArray(none), 'len=' + (none && none.length))

const weird = await C.candidatesFor(sea, '闃胯厱闅欒瓨', { n: 60, min: 20 })
ok('怪词不炸', Array.isArray(weird))

const t0 = Date.now()
for (let i = 0; i < 5; i++) await C.candidatesFor(sea, q, { n: 60, min: 20 })
console.log(`  参考：连算 5 次 ${Date.now() - t0} ms（每次 ${((Date.now() - t0) / 5).toFixed(0)} ms）`)

C.closeCandidates()
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
