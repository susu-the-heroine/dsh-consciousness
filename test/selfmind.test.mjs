/**
 * 私有池 + 心事 的测试
 * ===================
 *
 * 这两块会写盘，所以测试用真文件（跑完自己清），并且每条断言都要能解释：
 * 为什么这么写、写错了会怎样。
 *
 * 跑法：node test/selfmind.test.mjs
 */
// 测试用临时文件，不在真数据上跑
import { tmpdir } from 'node:os'
process.env.DSH_SELFMIND_FILE = String(tmpdir()) + '/dsh-self-test-' + process.pid + '.json'
process.env.DSH_SELFMODE_FILE = String(tmpdir()) + '/dsh-mode-test-' + process.pid + '.json'

import { existsSync, rmSync, copyFileSync } from 'node:fs'

const BASE = new URL('../', import.meta.url).href
const S = await import(BASE + 'lib/selfmind.js')
const M = await import(BASE + 'lib/selfmode.js')
const P = await import(BASE + 'lib/preoccupations.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

// 清干净再测
const F = S.selfPath()
// 不删真文件：先备份，测完还原（这条是拿她的念头换的）
// 当日计数清零：真数据里今天可能已经写过，不清会把额度测试带偏
try { const m = M.readMode(); m.thoughtsToday = 0; M.writeMode(m) } catch {}
if (existsSync(F) && !existsSync(F + '.testbak')) copyFileSync(F, F + '.testbak')

console.log('\n私有池：')

ok(S.remainingToday(null, Date.now()) === S.DAILY_LIMIT, '今天还没写：额度是满的')

const a = S.addThought({ text: '今天想通了一点点：慢比快难。', origin: 'review', dim: 'wistful' }, Date.now())
ok(a.ok, '第一条写得进去', a.reason)
ok(a.thought.id > 0 && a.thought.archived === false, '写进来的带着编号、还没归档')

const b = S.addThought({ text: '这句很短。', origin: 'assoc' }, Date.now())
const c = S.addThought({ text: '第三条。', origin: 'model' }, Date.now())
ok(b.ok && c.ok, '一天写三条：可以')

const d = S.addThought({ text: '第四条。', origin: 'assoc' }, Date.now())
ok(!d.ok && d.reason.includes('够了'), '第四条被挡住（一天最多三条）', d.reason)

// 重复的不能写
const dup = S.addThought({ text: '这句很短。', origin: 'assoc' }, Date.now())
ok(!dup.ok, '重复的念头不写第二遍', dup.reason)

// 太长要截断
const long = S.addThought({ text: '啊'.repeat(500), origin: 'assoc' }, Date.now() + 86400000)
ok(long.ok && long.thought.text.length <= S.MAX_LEN, '太长的截到上限', String(long.thought && long.thought.text.length))

// 列出来
const list = S.listThoughts(10)
ok(list.length >= 3, '能列出来', String(list.length))
ok(list[0].born >= list[list.length - 1].born, '按时间倒序')

// 挑一条最该想起：得是池子里的
const picked = S.pickForRecall(() => 0.5, Date.now())
ok(picked && picked.id > 0, '能挑出一条来想')

// 被想起一次，强度要涨
const st0 = Number(picked.strength)
S.touchThought(picked.id, Date.now())
const after = S.listThoughts(30, true).find((x) => x.id === picked.id)
ok(after.strength > st0, '想起一次，强度涨了', st0 + ' → ' + after.strength)

// 归档：久 + 弱 → 沉下去（不删）
const pool0 = S.readSelf()
for (const th of pool0.thoughts) {
  th.born = Date.now() - 100 * 86400000
  th.strength = 3
}
S.writeSelf(pool0)
const moved = S.sweepThoughts(Date.now())
ok(moved > 0, '又老又弱的会被归档', String(moved))
ok(S.readSelf().thoughts.length === pool0.thoughts.length, '归档不是删（条数没变）')

// 删
const before = S.readSelf().thoughts.length
const dropped = S.dropThought(a.thought.id)
ok(dropped && S.readSelf().thoughts.length === before - 1, '可以删掉一条')

console.log('\n心事：')

const now = Date.now()
const items = [
  { id: 'x1', kind: 'promise', text: '录 C 段', born: now - 3 * 86400000, injectedCount: 0 },
  { id: 'x2', kind: 'question', text: '他问的那个问题', born: now - 1 * 86400000, injectedCount: 0 },
  { id: 'x3', kind: 'thought', text: '我自己想不通的', born: now - 5 * 86400000, injectedCount: 0 },
]
const top = P.topItems(items, 3, now)
ok(top.length === 3, '三件都在')
ok(top[0].id === 'x1', '最重的是欠着的', top[0].id)
ok(typeof top[0].weight === 'number' && top[0].weight > 0, '带得出重量')

// 越老越重
const old1 = P.weightOf({ kind: 'promise', born: now - 10 * 86400000, injectedCount: 0 }, now)
const young1 = P.weightOf({ kind: 'promise', born: now, injectedCount: 0 }, now)
ok(old1 > young1, '越久没兑现，越压着')

// 说过了会松一口气
const talked = P.weightOf({ kind: 'promise', born: now - 10 * 86400000, injectedCount: 2 }, now)
ok(talked < old1, '说过两次，重量降了', old1 + ' → ' + talked)

// 三次之后判"想过了"
ok(!P.isSettled({ injectedCount: 2 }), '两次还没想通')
const settled = P.markInjected({ id: 'y', injectedCount: 2, kind: 'promise', text: 't', born: now })
ok(P.isSettled(settled) && settled.done, '第三次之后判「想过了」并出队')

// 只留最重的三件
const many = Array.from({ length: 6 }, (_, i) => ({
  id: 'm' + i, kind: 'promise', text: '第' + i, born: now - i * 86400000, injectedCount: 0,
}))
ok(P.topItems(many, P.MAX_ITEMS, now).length === P.MAX_ITEMS, '从六件里只挑三件')

// 收集：约定 + 问句 + 念头，去重
const collected = P.collect({
  promises: ['录 C 段', '录 C 段'],
  lastAsked: '那到底怎么办？',
  thoughts: [{ id: 77, text: '我总觉得哪儿不对', born: now }],
}, now)
ok(collected.length === 3, '三样各来一件，重复的并掉', String(collected.length))
ok(collected.every((x) => x.id && x.text && x.kind), '每件都有形状完整的字段')

// 描述不带问号、不催
const desc = P.describeItem(collected[0], now)
ok(desc.length > 0 && !/[？?]/.test(desc), '描述里没有问号', desc)

// 收尾清理
if (existsSync(F + '.testbak')) { copyFileSync(F + '.testbak', F); rmSync(F + '.testbak') } else if (existsSync(F)) rmSync(F)

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
