/**
 * 慢查询清单 · 正反自测
 *
 * 正：超过阈值的记下来，能读回来、能统计、能截断。
 * 反：没超阈值的一条都不许记。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/slowlog.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'slow-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
process.env.C2_SLOW_MS = '100'

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const S = await import(LIB + '/slowlog.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

// 反：低于阈值不记
S.noteSlow({ ms: 12, sea: 'main', q: '太快了' })
t('低于阈值不记', S.readSlow(10).length === 0)

// 正：超过阈值记下来，原话在
S.noteSlow({ ms: 321.5, sea: 'main', q: '那次特别慢的查询', seg: { total: 321 } })
const rows = S.readSlow(10)
t('超过阈值记一条', rows.length === 1)
t('原文保留', rows[0] && rows[0].q === '那次特别慢的查询', JSON.stringify(rows[0]))
t('毫秒舍到一位', rows[0] && rows[0].ms === 321.5, String(rows[0] && rows[0].ms))

// 正：统计
S.noteSlow({ ms: 250, sea: 'main', q: '第二条' })
const st = S.slowStats()
t('统计条数', st.n === 2, JSON.stringify(st))
t('最慢认得出', st.max === 321.5, String(st.max))

// 正：截断（写满 2005 行，只留 2000）
const f = S.slowPath()
const lines = []
for (let i = 0; i < 2005; i++) lines.push(JSON.stringify({ t: 1, ms: 101, sea: 'main', q: 'x' + i }))
writeFileSync(f, lines.join('\n') + '\n')
S.noteSlow({ ms: 150, sea: 'main', q: '触发截断' })
const kept = readFileSync(f, 'utf8').split('\n').filter(Boolean)
t('截断后不超 2000 行', kept.length <= 2000, String(kept.length))
t('最新那条还在', kept[kept.length - 1].includes('触发截断'))

// 反：阈值可调，调高就不记
process.env.C2_SLOW_MS = '1000'
rmSync(f, { force: true })
S.noteSlow({ ms: 500, sea: 'main', q: '五百不该记' })
t('调高阈值后不记', S.readSlow(10).length === 0)

console.log(`慢查询清单：通过 ${ok} · 失败 ${bad}`)
rmSync(home, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
