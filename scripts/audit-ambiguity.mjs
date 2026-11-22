/**
 * 歧义闸的误报清单（只读，不写）
 * ==============================
 *
 *   node scripts/audit-ambiguity.mjs [海名]
 *
 * 干一件事：看你库里有多少「同一个人同一件事挂了好几件」。
 * 这些地方，问「他那个被偷了的东西」会被反问——不是它懒，是本来就分不清。
 * 只读，一个字都不写。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { readSea } = await import(LIB + '/store.js')

const sea = process.argv[2] || 'main'
const data = readSea(sea)
const points = (data && data.points) || []
const alive = points.filter((p) => p && !p.dead)

const EVENTS = /(被偷了|修好了|送人了|摔坏了|忘在车上|一直没动|换了新的|借出去了|丢了|坏了)/

// 「谁」：标题里量词前面那一截
const who = (t) => {
  const m = String(t || '').match(/^(.{1,8}?)(?:那|这)[辆台把只盆副盏口张条件套间本双块根片]/)
  return m ? m[1] : ''
}
const what = (t) => {
  const m = String(t || '').match(/(?:那|这)[辆台把只盆副盏口张条件套间本双块根片]([\u4e00-\u9fa5]{2,6})/)
  return m ? m[1] : ''
}

const groups = new Map()
for (const p of alive) {
  const ev = (String(p.title || '').match(EVENTS) || [])[1]
  if (!ev) continue
  const w = who(p.title)
  if (!w) continue
  const k = w + '|' + ev
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(p)
}

const hits = [...groups.entries()].filter(([, arr]) => arr.length >= 2)
  .sort((a, b) => b[1].length - a[1].length)

console.log(`海：${sea} · 条目 ${alive.length} · 同人同事多件的组 ${hits.length}`)
for (const [k, arr] of hits.slice(0, 12)) {
  const [w, ev] = k.split('|')
  console.log(`  ${w} · ${ev} → ${arr.map((p) => what(p.title) || p.title).join('、')}`)
}
if (!hits.length) console.log('  一组都没有——这条闸现在不会响')
