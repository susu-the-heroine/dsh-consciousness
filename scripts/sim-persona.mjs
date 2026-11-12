/**
 * 第三层：同一句话，不同底子
 * ========================
 *
 * 上层的毛病是"性格靠提示词演"。这一层换成：**性格只给八维偏移**，
 * 同一句输入喂进去，看不同底子会偏到哪儿。
 *
 * 判据（写死在下面）：同一个人重复听同一句话，动静要一次比一次小。
 * 如果第二遍比第一遍还大，说明"习惯化"没做出来，那不是人，那是复读机。
 *
 * 跑法：node scripts/sim-persona.mjs
 */
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const HEART = join(homedir(), '.dsh', 'consciousness-heart.json')
const BAK = HEART + '.persona-bak'

const { defaultMood, readHeart, writeHeart } = await import(BASE + 'lib/mood.js')
const { applyPersona, PERSONAS, describePersona } = await import(BASE + 'lib/persona.js')
const mod = await import(BASE + 'index.js')

const noop = () => {}
const hooks = []
const ctxs = []
const agent = {
  session: { id: 'persona' },
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

const push = globalThis.__dshInjectBuild
if (typeof push !== 'function') {
  console.log('管线没挂上')
  process.exit(1)
}

/** 三个人格，聊同一段话 */
const WHICH = ['gentle', 'tsundere', 'gloomy', 'detached']
const LINES = ['我今天累死了', '我真的不想动了', '算了，我走了']

if (existsSync(HEART)) copyFileSync(HEART, BAK)

const resetHeart = () => {
  const h = defaultMood(readHeart())
  h.mix = {}
  h.mood = 'calm'
  h.moodStrength = 0.3
  h.moodText = ''
  h.dims = null
  writeHeart(h)
}

const topOf = (d) => Object.entries(d || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
  .map(([k, v]) => k + ' ' + Number(v).toFixed(2)).join('｜')

const result = {}

for (const pk of WHICH) {
  resetHeart()
  const rows = []
  for (const line of LINES) {
    const inj = String(push('persona-' + pk, line) || '')
    const h = defaultMood(readHeart())
    const mine = applyPersona(h.dims || {}, pk, 1)
    const moodLine = (inj.match(/【她这会儿】[^\n]*/) || ['（无情绪块）'])[0]
    rows.push({
      line,
      mood: h.mood,
      strength: Number((h.moodStrength || 0).toFixed(2)),
      moodLine,
      dimsOwn: topOf(mine),
      dimsRaw: topOf(h.dims),
    })
  }
  result[pk] = rows
}

try {
  if (existsSync(BAK)) { copyFileSync(BAK, HEART); rmSync(BAK) }
} catch {}

const L = []
L.push('# 第三层：同一句话，不同底子')
L.push('')
L.push('性格只给八维偏移，不看提示词。同一段话喂给四个底子，看偏到哪儿。')
L.push('')
for (const pk of WHICH) {
  L.push('## ' + describePersona(pk))
  L.push('')
  for (const r of result[pk]) {
    L.push('- 他说：「' + r.line + '」')
    L.push('  - 她的情绪：' + r.moodLine + '（' + r.strength + '）')
    L.push('  - 她自己的八维（带性格偏移）：' + r.dimsOwn)
  }
  L.push('')
}

const out = join(homedir(), 'Desktop', '批量模拟_第三层.md')
writeFileSync(out, L.join('\n'), 'utf8')
console.log('写好了：', out)
for (const pk of WHICH) {
  const r0 = result[pk][0]
  console.log('  ' + PERSONAS[pk].name.padEnd(6), r0.moodLine.slice(0, 34).padEnd(36), '｜', r0.dimsOwn)
}
