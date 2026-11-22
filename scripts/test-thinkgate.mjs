// 验收触发：数新料，不数次数。
//
// 2026-11-21：这份原来读真实家目录的海，还会写真实那个闸文件、最后把它清成零。
// 跑一遍就等于替他重置了一次状态。改成临时家目录 + 假海，闸文件也写在临时目录里。
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'thinkgate-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const sea = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(sea, { recursive: true })
const now = Date.now()
const points = [
  { id: 1, title: '旧唱片机', text: '唱片机是二手的，唱针换过一次。', kind: 'fact', imp: 0.6, arousal: 4, born: now - 86400000, strength: 60, layer: 'experience' },
  { id: 2, title: '停电那晚', text: '去年夏天停过一次电，冰箱里的奶全废了。', kind: 'event', imp: 0.7, arousal: 6, born: now - 172800000, strength: 60, layer: 'experience' },
]
writeFileSync(join(sea, 'data.json'), JSON.stringify({ version: 1, points, edges: [] }), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { shouldThinkNow } = await import(LIB + '/thinkauto.js')

const F = join(home, '.dsh', 'consciousness-thinkgate.json')
const data = JSON.parse(readFileSync(join(sea, 'data.json'), 'utf8').replace(/^﻿/, ''))
const pts = data.points || []
const today = new Date().toISOString().slice(0, 10)
const set = (count, last) => writeFileSync(F, JSON.stringify({ day: today, count, last }), 'utf8')
const show = (name, count, last) => {
  set(count, last)
  const r = shouldThinkNow(pts, null, now)
  console.log(name + ' → ' + (r.ok ? '想（' + r.why + '）' : '不想（' + r.why + '）'))
}

show('想过后库里又添了新东西', 3, now - 3 * 3600000)
show('想过后库里没动，刚错过一小时', 3, now - 60 * 60000)
show('想过后很久没动库', 3, now - 5 * 3600000)
show('兜底上限', 20, now - 5 * 3600000)
set(0, 0)
console.log('（闸文件只写在临时目录里，没碰他的：' + F + '）')
