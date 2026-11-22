/**
 * 偏心与残温
 * ==========
 *
 *   node scripts/test-humanness2.mjs
 *
 * 偏心：被想起过很多次的记得细，没人想起的一句话带过；只动字数，不动标签真假。
 * 残温：上一轮的火气或暖意会改开口那句，同一天同一句话也能看出来。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { detailFor, closenessOf, openLineFor } = await import(L + '/tools.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const stranger = detailFor({ imp: 0.5, recallCount: 0 })
const close = detailFor({ imp: 0.5, recallCount: 900 })
ok('熟人记得更细', close.len > stranger.len, stranger.len + ' vs ' + close.len)
ok('生人也不会缩成一句', stranger.len >= 40, String(stranger.len))
ok('标签不因亲疏变', close.note === stranger.note && close.note === '', close.note)

const p = { id: 7 }
ok('没邻居算生', closenessOf(p, []) === 0)
ok('边多算熟', closenessOf(p, [{ from: 7, to: 1 }, { from: 7, to: 2 }, { from: 7, to: 3 }, { from: 7, to: 4 }, { from: 7, to: 5 }, { from: 7, to: 6 }, { from: 7, to: 8 }, { from: 7, to: 9 }]) > 0)
ok('脏数据不炸', Number.isFinite(closenessOf(null, null)))

const now = Date.UTC(2026, 10, 16, 12)
const cold = openLineFor('显卡那件事', 2, now, -1)
const warm = openLineFor('显卡那件事', 2, now, 1)
const flat = openLineFor('显卡那件事', 2, now, 0)
ok('冷口气不一样', cold !== flat, cold)
ok('暖口气不一样', warm !== flat, warm)
ok('数字与问答一个不改', [cold, warm, flat].every((s) => s.includes('显卡那件事') && s.includes('2')))

console.log(`\n偏心与残温自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
