/**
 * 冲突检测 + 关系历史 的测试
 * ========================
 * 跑法：node test/conflict-history.test.mjs
 */
import { existsSync, rmSync } from 'node:fs'

const BASE = new URL('../', import.meta.url).href
const C = await import(BASE + 'lib/conflict.js')
const RL = await import(BASE + 'lib/relationlog.js')
const R = await import(BASE + 'lib/relation.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n冲突检测：')

const now = Date.now()
// 同一个键，两条都活着 → 冲突
const pts1 = [
  { id: 1, factKey: 'he.city', title: '他住济南', validUntil: null, born: now - 9e6 },
  { id: 2, factKey: 'he.city', title: '他搬到青岛', validUntil: null, born: now },
]
const c1 = C.findConflicts(pts1)
ok(c1.length === 1, '同键两条都活着 → 算一次冲突', String(c1.length))
ok(c1[0].items[0].id === 2, '新的排前面（按出生时间倒序）', String(c1[0].items[0].id))
const d1 = C.describeConflict(c1[0])
ok(d1.includes('不是一回事'), '说清了"这不是一回事"', d1)
ok(!/[？?]/.test(d1), '不长问号（不是反问句）')

// 有一条已失效 → 不算冲突
const pts2 = [
  { id: 1, factKey: 'he.city', title: '旧', validUntil: now - 1e6, born: now - 9e6 },
  { id: 2, factKey: 'he.city', title: '新', validUntil: null, born: now },
]
ok(C.findConflicts(pts2).length === 0, '旧版本已失效 → 不算冲突')

// 没有事实键的条目 → 永远不冲突
const pts3 = [
  { id: 1, title: 'a', validUntil: null },
  { id: 2, title: 'b', validUntil: null },
]
ok(C.findConflicts(pts3).length === 0, '没有事实键 → 不算冲突')

// 三条同键 → 还是一处冲突，但列三版
const pts4 = [
  { id: 1, factKey: 'x', title: 'a', validUntil: null, born: 1 },
  { id: 2, factKey: 'x', title: 'b', validUntil: null, born: 2 },
  { id: 3, factKey: 'x', title: 'c', validUntil: null, born: 3 },
]
ok(C.findConflicts(pts4)[0].items.length === 3, '三条同键都能列出来')

console.log('\n关系历史：')

const F = RL.pathOf()
if (existsSync(F)) rmSync(F)

const st1 = { events: 5, kept: 0, broken: 0, days: 3 }
RL.recordToday(st1, now - 5 * 86400000)
const st2 = { events: 40, kept: 2, broken: 0, days: 10 }
RL.recordToday(st2, now)

const days = RL.recentHistory(14)
ok(days.length === 2, '存了两天', String(days.length))
ok(days[0].day < days[1].day, '按日期正序')

const trend = RL.describeHistory(days)
ok(trend.length > 0, '能说出这段关系怎么变的', trend)
ok(!/[？?]/.test(trend), '趋势句不带问号')

// 同一天重复写，只覆盖不追加
RL.recordToday(st2, now)
ok(RL.recentHistory(14).length === 2, '同一天重复写不会变两天')

// 只一天时不该硬编趋势
RL2: {
  const single = RL.recentHistory(1)
  ok(RL.describeHistory(single) === '', '只有一天时不说趋势')
}

if (existsSync(F)) rmSync(F)

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
