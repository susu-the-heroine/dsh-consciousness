// 验收触发：数新料，不数次数。
import { readFileSync, writeFileSync } from 'node:fs'
import { shouldThinkNow } from '../lib/thinkauto.js'

const F = process.env.USERPROFILE + '/.dsh/consciousness-thinkgate.json'
const data = JSON.parse(readFileSync(process.env.USERPROFILE + '/.dsh/consciousness-seas/main/data.json', 'utf8'))
const pts = data.points || []
const today = new Date().toISOString().slice(0, 10)
const now = Date.now()
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
