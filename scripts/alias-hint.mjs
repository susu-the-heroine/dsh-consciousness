/**
 * 别名缺口清单
 * ============
 *
 * 为什么要有这个：别名是个好机制，但要有人填。全库一百多条，
 * 挨个填不现实；先填"最常被想起的"——那些才是天天要用的。
 *
 * 排序按 recallCount（被想起过几次）。没被想起过的排后面：
 * 它们不是不重要，是还没轮到。
 *
 * 用法：
 *   node scripts/alias-hint.mjs          # 看前 20 条缺别名的
 *   node scripts/alias-hint.mjs 40       # 看前 40 条
 *   node scripts/alias-hint.mjs --stats  # 只看覆盖率
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SEA = join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json')

const argv = process.argv.slice(2)
const statsOnly = argv.includes('--stats')
const n = Number(argv.find((x) => /^\d+$/.test(x)) || 20)

if (!existsSync(SEA)) {
  console.log('没找到识海数据：' + SEA)
  process.exit(1)
}

const data = JSON.parse(readFileSync(SEA, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
const withAlias = pts.filter((p) => String(p.alias || '').trim())
const miss = pts
  .filter((p) => !String(p.alias || '').trim())
  .sort((a, b) => (Number(b.recallCount) || 0) - (Number(a.recallCount) || 0)
    || (Number(b.imp) || 0) - (Number(a.imp) || 0))

const pct = pts.length ? Math.round((withAlias.length / pts.length) * 100) : 0
console.log('别名覆盖：' + withAlias.length + '/' + pts.length + '（' + pct + '%）')

if (!statsOnly) {
  if (!miss.length) {
    console.log('全填上了，没缺口。')
  } else {
    console.log('\n最该补的前 ' + Math.min(n, miss.length) + ' 条（按被想起次数）：')
    for (const p of miss.slice(0, n)) {
      const rc = Number(p.recallCount) || 0
      console.log('  #' + String(p.id).padStart(3) + '  想起 ' + String(rc).padStart(2) + ' 次  ' + String(p.title || '').slice(0, 40))
    }
    console.log('\n填法：memory_add 时带 alias；补旧的直接在 data.json 里加 alias 字段。')
    console.log('一句话就够：别人会怎么问这条（用大白话，别照抄标题）。')
  }
}
