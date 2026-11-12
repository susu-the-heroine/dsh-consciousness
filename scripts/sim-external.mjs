/**
 * 拿真人的话去撞识海
 * ==================
 * 这批 2.6 万条不是训练料，也不是"像人"的标准——它的正经用途是**当刁钻输入**。
 * 真人的话有错字、断句、指代不明、脏话、省略，最容易撞出解析和检索的 bug。
 *
 * 跑法：node scripts/sim-external.mjs [条数]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const N = Number(process.argv[2]) || 300

const store = await import(BASE + 'lib/store.js')
// 真管线要先把插件挂起来，__dshInjectBuild 才会出现（跟 sim-auto 一个路子）
const mod = await import(BASE + 'index.js')
const noop = () => {}
const hooks = []
const ctxs = []
const agent = {
  session: { id: 'sim-external' },
  ctx: {
    get: () => undefined,
    on: (n, f) => { hooks.push([n, f]); return () => {} },
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
const build = globalThis.__dshInjectBuild
if (typeof build !== 'function') { console.log('管线没挂上'); process.exit(1) }

const lines = readFileSync(join(homedir(), '.dsh', '记忆', '_外人语料.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
  .filter(Boolean)
  .map((r) => r.text)

// 均匀抽，别只抽前几百条
const pick = []
const step = Math.max(1, Math.floor(lines.length / N))
for (let i = 0; i < lines.length && pick.length < N; i += step) pick.push(lines[i])

const sea = store.readSea('main')
const sid = 'sim-external'

const problems = []
const stats = { ok: 0, empty: 0, short: 0, maxLen: 0, totalLen: 0 }

for (const text of pick) {
  let out = null
  try {
    out = build(sid, text)
  } catch (e) {
    problems.push({ t: '构建时抛错', text, note: String((e && e.message) || e).slice(0, 100) })
    continue
  }
  if (typeof out !== 'string') {
    problems.push({ t: '返回值不是字符串', text, note: typeof out })
    continue
  }
  const len = out.length
  stats.totalLen += len
  stats.maxLen = Math.max(stats.maxLen, len)
  if (!len) { stats.empty++; problems.push({ t: '注入是空的', text, note: '' }); continue }
  stats.ok++
  // 必须有这几块，少一块就是注入被撞坏了
  for (const must of ['【识海', '【她这会儿】']) {
    if (!out.includes(must)) {
      problems.push({ t: '缺了「' + must + '」', text, note: 'len=' + len })
      break
    }
  }
  if (len > 2600) problems.push({ t: '注入超长', text, note: 'len=' + len })
  if (len < 120) { stats.short++; problems.push({ t: '注入过短', text, note: 'len=' + len }) }
}

console.log('拿真人原话撞识海：', pick.length, '条')
console.log('  正常', stats.ok, '｜空', stats.empty, '｜过短', stats.short)
console.log('  平均长度', Math.round(stats.totalLen / pick.length), '｜最长', stats.maxLen)
console.log('  问题', problems.length, '条')
for (const p of problems.slice(0, 12)) {
  console.log('  [' + p.t + '] 「' + String(p.text).slice(0, 30) + '」 ' + p.note)
}
if (!problems.length) console.log('  一条问题都没有——这批输入没撞出东西。')
