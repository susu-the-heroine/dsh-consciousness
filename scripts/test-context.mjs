/**
 * 指着说：接回上一句
 * ==================
 *
 *   node scripts/test-context.mjs
 *
 * 正面：上一句里有「那台旧相机」，问「那个东西后来咋了」→ 换成「那台旧相机后来咋了」
 * 反面：没有指代、没有上一句、上一句没有东西可指——原样返回，不许乱接
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/context.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { resolveRef, pickReferent } = await import(L + '/context.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const r1 = resolveRef('那个东西后来咋了', '老周那台旧相机被偷了')
ok('接得回上一句的东西', r1.includes('那台旧相机'), r1)

const r2 = resolveRef('它后来修好了吗', '我把那副羽毛球拍摔坏了')
ok('「它」也接得上', /羽毛球拍/.test(r2), r2)

ok('没指代就原样', resolveRef('显卡那晚咋了', '老周那台旧相机被偷了') === '显卡那晚咋了')
ok('没上一句就原样', resolveRef('那个东西后来咋了', '') === '那个东西后来咋了')
ok('上一句没东西就原样', resolveRef('那个东西后来咋了', '今天挺累的') === '那个东西后来咋了')
const amb = resolveRef('那个东西后来咋了', '老周那台旧相机和阿亮那辆电动车都被偷了')
ok('上一句有两个东西就弃权', amb === '那个东西后来咋了', amb)
ok('挑得到东西', /那台旧相机/.test(pickReferent('老周那台旧相机被偷了')))
ok('挑不到就空', pickReferent('今天挺累的') === '')
ok('脏值不炸', resolveRef(null, null) === '' && pickReferent(null) === '')

console.log(`\n指着说自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
