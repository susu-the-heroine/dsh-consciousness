/**
 * 记忆质量体检
 * ============
 * 扫一个识海，按两把尺子（具体物 / 人味）给每条打分。
 * 低于线的标"泛"——那种记忆将来查出来也想不起来。
 *
 * 跑法：node scripts/audit-quality.mjs [sea]
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const sea = process.argv[2] || 'main'

const store = await import(BASE + 'lib/store.js')
const { checkVoice } = await import(BASE + 'scripts/voice-check.mjs')
const { humanness } = await import(BASE + 'lib/humanness.js')

const d = store.readSea(sea)
if (!d) {
  console.log('读不到识海：' + sea)
  process.exit(1)
}
const pts = (d.points || []).filter((p) => !p.dead)
const rows = pts.map((p) => {
  const body = String(p.title || '') + '。' + String(p.text || '') + String((p.herSide && p.herSide.felt) || '')
  const v = checkVoice(body)
  const h = humanness(body)
  return {
    id: p.id,
    title: String(p.title || '').slice(0, 28),
    v: v.score,
    h: h.score,
    flat: v.score < 0.3 || h.score < 0.45,
    kind: String(p.kind || ''),
  }
})
const avg = (k) => (rows.reduce((s, r) => s + r[k], 0) / (rows.length || 1)).toFixed(3)
const flat = rows.filter((r) => r.flat)
rows.sort((a, b) => a.h - b.h)

console.log('识海', sea, '｜', rows.length, '条')
console.log('  具体物均分', avg('v'), '｜人味均分', avg('h'))
console.log('  偏泛', flat.length, '条（' + (flat.length / (rows.length || 1) * 100).toFixed(1) + '%）')

const L = []
L.push('# 记忆质量体检 · ' + sea)
L.push('')
L.push('共 ' + rows.length + ' 条｜具体物均分 ' + avg('v') + '｜人味均分 ' + avg('h'))
L.push('')
L.push('偏泛 ' + flat.length + ' 条（' + (flat.length / (rows.length || 1) * 100).toFixed(1) + '%）')
L.push('理由：缺具体的人/物件/数字，或者通篇是"有些事""说不清"这类空话。这种将来查出来也想不起来。')
L.push('')
L.push('## 最泛的二十条')
L.push('')
for (const r of rows.slice(0, 20)) {
  L.push('- #' + r.id + ' ' + r.title + '　具体物 ' + r.v.toFixed(2) + ' / 人味 ' + r.h.toFixed(2) + (r.flat ? '　**泛**' : ''))
}
L.push('')
L.push('## 已经标了 flat 的')
L.push('')
const marked = pts.filter((p) => p.flat)
if (!marked.length) L.push('（没有；flat 标记从这次改动之后才开始打）')
for (const p of marked.slice(0, 20)) L.push('- #' + p.id + ' ' + String(p.title || '').slice(0, 28))

const out = join(homedir(), 'Desktop', '记忆质量体检.md')
writeFileSync(out, L.join('\n'), 'utf8')
console.log('报告：', out)
