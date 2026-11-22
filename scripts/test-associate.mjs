// 联想验收：给一个词，看它牵出几层。
// 跑法：node scripts/test-associate.mjs 经十路
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { associate } from '../lib/associate.js'

const q = process.argv[2] || '经十路'
// 2026-11-21：原来拿「用户目录变量」拼字符串——那个变量没设时拼出来是「undefined/.dsh/...」，
// 直接读文件报错。改用系统给的家目录（它本来就先看这个变量、没有再退回另一个）。
const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const r = associate(data.points, q, { n: 4 })
console.log('=== 从「' + q + '」出发 · 直接提到 ' + (r.total || 0) + ' 条')
for (const h of r.hops) {
  console.log(' [' + h.label + ']')
  for (const it of h.items) console.log('   #' + it.id, it.title, '（' + it.why + '）')
}
