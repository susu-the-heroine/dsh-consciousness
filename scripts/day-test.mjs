/**
 * 本地日期自测
 * ============
 *   node scripts/day-test.mjs
 *
 * 2026-11-20 的坑：几处按国际时间算「今天」，中国时间凌晨写的会算到前一天。
 * 这里钉住：本地凌晨与深夜都要落在本地那一天，不能跨到前一天/后一天。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const D = await import('file:///' + join(HERE, '..', 'lib', 'day.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }

ok('凌晨 00:30 还是当天', D.localDay(new Date(2026, 0, 1, 0, 30).getTime()) === '2026-01-01')
ok('深夜 23:50 还是当天', D.localDay(new Date(2026, 0, 1, 23, 50).getTime()) === '2026-01-01')
ok('月底最后一天不越界', D.localDay(new Date(2026, 1, 28, 1, 0).getTime()) === '2026-02-28')
ok('月日两位补零', D.localMmDd(new Date(2026, 8, 5).getTime()) === '09-05')
ok('月和日都不补零时也对', D.localMmDd(new Date(2026, 10, 20).getTime()) === '11-20')

console.log(`\n本地日期：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
