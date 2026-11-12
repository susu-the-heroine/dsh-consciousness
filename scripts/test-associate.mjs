// 联想验收：给一个词，看它牵出几层。
// 跑法：node scripts/test-associate.mjs 经十路
import { readFileSync } from 'node:fs'
import { associate } from '../lib/associate.js'

const q = process.argv[2] || '经十路'
const data = JSON.parse(readFileSync(process.env.USERPROFILE + '/.dsh/consciousness-seas/main/data.json', 'utf8'))
const r = associate(data.points, q, { n: 4 })
console.log('=== 从「' + q + '」出发 · 直接提到 ' + (r.total || 0) + ' 条')
for (const h of r.hops) {
  console.log(' [' + h.label + ']')
  for (const it of h.items) console.log('   #' + it.id, it.title, '（' + it.why + '）')
}
