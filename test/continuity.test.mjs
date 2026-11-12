/**
 * 连续性回归：断档回来，能不能接上上次
 * ====================================
 *
 * 三条断言：
 *   1. 断档 45 分钟 → 注入里必须有【接上上次】，并且带上他最后那句
 *   2. 断档 5 分钟（同一个会话没断）→ 不许出现，不然每轮都复述
 *   3. 上一句是问句 → 要标出来「当时没答完的，接上」
 *
 * 跑法：node test/continuity.test.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOME = process.env.USERPROFILE || homedir()
const SEA_DIR = join(HOME, '.dsh', 'consciousness-seas', 'main')
const HP = join(SEA_DIR, 'handoff.json')
const BASE = new URL('../', import.meta.url).href

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name) }
}

/** 用一条指定年龄的交接条，跑一次注入，拿到注入文本 */
async function injectWith(ageMin, said, asked) {
  mkdirSync(SEA_DIR, { recursive: true })
  writeFileSync(HP, JSON.stringify({
    at: Date.now() - ageMin * 60000,
    sid: 'session-test',
    said,
    asked: !!asked,
    mood: 'tired',
    moodText: '有点乏',
  }), 'utf8')

  const mod = await import(BASE + 'index.js?t=' + ageMin + said.length)
  const noop = () => {}
  const hooks = []
  const ctxs = []
  const agent = {
    session: { id: 'session-test' },
    ctx: {
      on: (n, fn) => { hooks.push([n, fn]); return () => {} },
      systemPrompt: { context: (o) => { ctxs.push(o); return () => {} } },
    },
  }
  mod.apply({
    effect: (fn) => { try { return fn() } catch { return noop } },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {} },
    get: (n) => (n === 'agents' ? { list: () => [agent] } : undefined),
    agents: { list: () => [agent] },
    interval: (fn) => { try { fn() } catch {} return { dispose: noop } },
    on: () => () => {},
    logger: { info: noop, warn: noop, error: noop },
    workspaceRegistry: { list: () => [] },
    sessions: {},
    sessionTitle: {},
  })
  const inbox = hooks.find((h) => h[0] === 'agent/inbox/inserted')
  if (inbox) inbox[1]({ message: { content: '接着上次说' } })
  return ctxs[0] ? String(ctxs[0].text() || '') : ''
}

console.log('连续性回归：')
const a = await injectWith(45, '最后那条片子到底怎么收尾？', true)
ok(a.includes('【接上上次】'), '断档 45 分钟 → 出现【接上上次】')
ok(a.includes('最后那条片子到底怎么收尾'), '带上了他最后那句')
ok(a.includes('当时没答完的话，接上'), '问句被标成「没答完」')

const b = await injectWith(5, '我回来了', false)
ok(!b.includes('【接上上次】'), '断档 5 分钟 → 不出现（同一个会话别复述）')

const c = await injectWith(180, '今天先到这儿', false)
ok(c.includes('【接上上次】'), '断档 3 小时 → 出现')
ok(c.includes('小时'), '时间单位会换算成小时')

// 收尾：把测试写的交接条清掉，别污染真的
try { if (existsSync(HP)) rmSync(HP) } catch {}

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
