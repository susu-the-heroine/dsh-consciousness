/**
 * 体检与快照自测
 * ==============
 *   node scripts/test-monitor.mjs
 *
 * 同一天只存一条、阈值报红、周检汇总、页面读得到历史。
 * 全程临时目录，碰不到真库。
 */
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库和页面都按当前目录找——换个目录跑就断。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-mon-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const M = await import(LIB + '/monitor.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

writeSea('main', { version: 3, points: [{ id: 1, title: 'a', text: 'b' }], edges: [] })

// 2026-11-21：原来用现在这一刻。第二句是「一小时后」，若在晚上十一点后跑就跨天，
// 于是「同一天不重复记」必挂——深夜跑测试正好是这个点。改成当天中午当基准。
const _base = new Date()
_base.setHours(12, 0, 0, 0)
const now = _base.getTime()
ok('记一条快照', M.recordSnapshot('main', { coverage: 100, stale_rate: 0, queued: 0, p95_ms: 3, bytes: 10, total: 1 }, now).added === true, '')
ok('同一天不重复记', M.recordSnapshot('main', { coverage: 100, stale_rate: 0, queued: 0, p95_ms: 3, bytes: 10, total: 1 }, now + 3600000).added === false, '')
ok('读得到这一条', M.readSnapshots('main', 30).length === 1, String(M.readSnapshots('main', 30).length))
ok('当天覆盖低要报红', M.recordSnapshot('main', { coverage: 88, stale_rate: 2, queued: 0, p95_ms: 10, bytes: 10, total: 1 }, now + 2 * 86400000).added === true
  && M.alertsFor('main').some((a) => a.code === 'coverage-low'), JSON.stringify(M.alertsFor('main')))
ok('队列卡住要报红', M.recordSnapshot('main', { coverage: 99, stale_rate: 0, queued: 5, p95_ms: 10, bytes: 10, total: 1 }, now + 3 * 86400000).added === true
  && (() => { const a = M.alertsFor('main'); return a.some((x) => x.code === 'queue-stuck') })() === false, '两小时那条是同一天，先不该报')
ok('两天都积压才报卡住', M.recordSnapshot('main', { coverage: 99, stale_rate: 0, queued: 7, p95_ms: 10, bytes: 10, total: 1 }, now + 4 * 86400000).added === true
  && M.alertsFor('main').some((a) => a.code === 'queue-stuck'), JSON.stringify(M.alertsFor('main')))

const wk = await M.weeklyReport(now)
ok('周检读得到海', wk.seas >= 1 && wk.points >= 1, JSON.stringify({ seas: wk.seas, points: wk.points }))
ok('周检落盘', M.weeklyReport_().length >= 1, String(M.weeklyReport_().length))

const page = readFileSync(join(HERE, '..', 'assets', '工作台.html'), 'utf8')
ok('页面读历史接口', page.includes('action=history'), '')
ok('页面显示体检结论', page.includes('体检正常') && page.includes('上次周检'), '')

console.log(`\n体检快照自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
