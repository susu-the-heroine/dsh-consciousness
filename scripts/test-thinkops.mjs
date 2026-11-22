// 十种动作验收：给一个词，看能开哪几种、各问什么。
// 跑法：node scripts/test-thinkops.mjs 薯片
import { readFileSync } from 'node:fs'
import { think, OP_TABLE } from '../lib/thinkops.js'

const q = process.argv[2] || '薯片'
const data = JSON.parse(readFileSync(process.env.USERPROFILE + '/.dsh/consciousness-seas/main/data.json', 'utf8').replace(/^\uFEFF/, ''))
console.log('表里有 ' + OP_TABLE.length + ' 种动作')
const r = think(data.points, { query: q }, { max: 6 })
console.log('种子「' + r.seed + '」 · 开了 ' + r.opened.length + ' 种：' + r.opened.join('、'))
console.log('没开的：' + r.closed.join('、'))
for (const o of r.ops) {
  // 2026-11-21：think() 交回来的每种动作带着 hint，不是 ask（ask 是表里那条模板）。
  // 原来印 o.ask，十种全印成 undefined——正好把这份脚本要给人看的那句话印没了。
  console.log('— [' + o.label + '] ' + (o.hint || o.ask || ''))
  for (const it of o.items) console.log('    #' + it.id + ' ' + it.title + '（' + it.why + '）')
}
