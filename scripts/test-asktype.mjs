/**
 * 问的是哪一样
 * ============
 *
 *   node scripts/test-asktype.mjs
 *
 * 正面：问「什么时候」判 time、问「后来呢」判 result、问「有没有」判 exist，且排序真会动
 * 反面：普通问句判空；exist 不动顺序；没日子没后来词的候选不许被抬；脏数据不炸
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 2026-11-21：按当前目录找库，换个目录跑就断。改成按本文件位置算。
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { classifyAsk, hasDate, hasResultWord, rerankByAsk } = await import(L + '/asktype.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

ok('问时间判 time', classifyAsk('那场球是什么时候的事') === 'time', classifyAsk('那场球是什么时候的事'))
ok('问后来判 result', classifyAsk('那个东西后来咋样了') === 'result')
ok('问有没有判 exist', classifyAsk('你记不记得他手机号') === 'exist')
ok('普通问句判空', classifyAsk('显卡那晚') === '')

const mk = (id, text, score) => ({ p: { id, text }, score })
const dated = mk(1, '2026-11-03 晚上九点多，他把记忆塞进 html', 0.7)
const undated = mk(2, '他把记忆塞进 html，具体哪天忘了', 0.72)
const list1 = rerankByAsk([undated, dated], 'time', (x) => x.p.text)
list1.sort((a, b) => b.score - a.score)
ok('问时间，有日子的上来了', list1[0].p.id === 1, list1.map((x) => x.p.id + ':' + x.score).join(','))

const res = mk(3, '后来他修好了，最后送去店里', 0.7)
const nores = mk(4, '那台相机被偷了', 0.72)
const list2 = rerankByAsk([nores, res], 'result', (x) => x.p.text)
list2.sort((a, b) => b.score - a.score)
ok('问后来，说清结果的上来了', list2[0].p.id === 3)

const list3 = [nores, res].map((x) => ({ ...x }))
const before = list3.map((x) => x.score)
rerankByAsk(list3, 'exist', (x) => x.p.text)
ok('问有没有，顺序不动', JSON.stringify(list3.map((x) => x.score)) === JSON.stringify(before))

const list4 = [nores, res].map((x) => ({ ...x }))
const b4 = list4.map((x) => x.score)
rerankByAsk(list4, '', (x) => x.p.text)
ok('判不准就不动', JSON.stringify(list4.map((x) => x.score)) === JSON.stringify(b4))

ok('没日子判没日子', hasDate('哪天忘了') === false && hasDate('11月3日') === true)
ok('没结果词判没结果', hasResultWord('被偷了') === false && hasResultWord('后来修好了') === true)
ok('脏数据不炸', rerankByAsk(null, 'time') && classifyAsk(null) === '')

console.log(`\n问的类型自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
