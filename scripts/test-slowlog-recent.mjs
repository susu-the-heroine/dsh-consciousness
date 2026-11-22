/**
 * 慢查询清单 · 正反自测
 *
 * 正：记三条慢的，清单要按慢到快排，字段齐（毫秒 + 问句）。
 * 反：不记的时候，清单是空的，不许编。
 * 门槛：默认一百毫秒；改开关要跟着变。
 */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/slowlog.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'slow-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
delete process.env.C2_SLOW_MS

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const S = await import(LIB + '/slowlog.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const empty = S.slowStats()
t('没记录时清单为空', Array.isArray(empty.recent) && empty.recent.length === 0, JSON.stringify(empty))
t('默认门槛一百毫秒', Number(empty.threshold) === 100, String(empty.threshold))

S.noteSlow({ q: '慢的那个', ms: 300 })
S.noteSlow({ q: '中等的', ms: 120 })
S.noteSlow({ q: '更慢的', ms: 450 })

const s = S.slowStats()
t('三条都记上了', s.n === 3, String(s.n))
t('清单按慢到快', s.recent[0] && s.recent[0].ms === 450, JSON.stringify(s.recent[0]))
t('清单带问句', s.recent[0] && s.recent[0].q === '更慢的', String(s.recent[0] && s.recent[0].q))
t('中位数取得对', s.p50 === 300, String(s.p50))
t('最慢取得对', s.max === 450, String(s.max))

process.env.C2_SLOW_MS = '50'
t('门槛能跟着开关变', Number(S.slowStats().threshold) === 50, String(S.slowStats().threshold))

console.log(`慢查询清单：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
