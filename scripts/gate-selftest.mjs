/**
 * 词闸自测：直接调 applyWordGate，不经过插件
 * ==========================================
 *
 * 为什么要有：2026-11-12 把一个热加载的函数改成 async，调用点没 await，
 * 加载没报错、语法也过，直到真检索才崩，把页面一起带走。
 * 所以改这个文件必须跑这个自测。
 *
 * 跑法：node scripts/gate-selftest.mjs
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const G = await import('file:///' + join(HERE, '..', 'lib', 'gate.js').replace(/\\/g, '/') + '?v=' + Date.now())

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  通过  ' + name) }
  else { fail++; console.log('  失败  ' + name + (extra ? ' → ' + extra : '')) }
}

const P = (title, text) => ({ id: title.length, title, text, alias: '' })
const pts = [
  P('腰疼和椅子', '你说腰疼，我让你站起来走两圈。'),
  P('手机号', '这条里没有号码。'),
]

// 1. 有真词命中：不该被筛掉
const strongWhy = [{ score: 86, why: ['字面 0.36', '同频 0.97'], p: pts[0] }]
const r1 = G.applyWordGate(strongWhy, '腰疼', pts)
ok('真命中要留下', Array.isArray(r1) && r1.length === 1, 'len=' + (r1 && r1.length))

// 2. 只有弱语义：应判成"库里没有"，返回空
const thinWhy = [{ score: 37, why: ['字面 0.27', '语义 0.48'], p: pts[1] }]
const r2 = G.applyWordGate(thinWhy, '他手机号是多少', pts)
ok('全弱要判成没有', Array.isArray(r2) && r2.length === 0, 'len=' + (r2 && r2.length))

// 3. 必词命中：留下
const mustWhy = [{ score: 40, why: ['必[手机号]'], p: pts[1] }]
const r3 = G.applyWordGate(mustWhy, '手机号', pts)
ok('必词命中要留下', Array.isArray(r3) && r3.length === 1)

// 4. 返回的必须是数组（防再有人改成 async）
ok('返回值是数组', Array.isArray(G.applyWordGate(strongWhy, '腰疼', pts)))

// 5. 空输入不炸
ok('空输入不炸', Array.isArray(G.applyWordGate([], '随便', pts)))

console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
