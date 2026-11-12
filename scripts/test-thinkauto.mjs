// 自己会想：跑一次，看它自己挑了哪条线索、想出几种。
import { readFileSync } from 'node:fs'
import { autoThinkOnce, readThoughts } from '../lib/thinkauto.js'

const data = JSON.parse(readFileSync(process.env.USERPROFILE + '/.dsh/consciousness-seas/main/data.json', 'utf8'))
const r = await autoThinkOnce(data.points, { max: 5 })
if (!r.ok) { console.log('没想成：' + r.reason); process.exit(0) }
const t = r.thought
console.log('自己挑的线索：#' + t.seedId + ' ' + t.seedTitle)
console.log('开出 ' + t.opened.length + ' 种：' + t.opened.join('、'))
for (const o of t.ops) {
  console.log('  [' + o.label + '] ' + o.hint)
  for (const it of o.items) console.log('      #' + it.id + ' ' + it.title + '（' + it.why + '）')
}
console.log('存下来的条数：' + readThoughts().length)
