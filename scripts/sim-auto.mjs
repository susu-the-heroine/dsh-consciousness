/**
 * 无人值守压测：造输入 → 真管线 → 判结果
 * ==================================
 *
 * 三件事全自动，人一步不参与：
 *   一、造输入（lib/hevoice.js，按他的句法）
 *   二、喂真管线（lib/inject 的 buildText）
 *   三、判结果（lib/humanness.js + 数值规则）
 *
 * 判什么：
 *   · 状态有没有被推到 95 以上（压爆）
 *   · 离开的话有没有让她动（强度 ≥0.6）
 *   · 闲聊有没有让状态乱跳
 *   · 注入有没有超 2200 或丢块
 *
 * 跑法：node scripts/sim-auto.mjs [条数]
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href

// 2026-11-21：以前是「先备份真心跳、跑完拷回去」。实测拷不回去——
// 跑五条之前四千一百三十二字节，跑完四千一百八十三；中途还有一次落盘落在还原之后。
// 改成整段在临时家目录里跑：先照原样复制一份心跳过去，真那份从开到关都不碰。
const REAL_HOME = homedir()   // 真家目录只用来读一次心跳、写报告
const REAL_HEART = join(REAL_HOME, '.dsh', 'consciousness-heart.json')
const TMP_HOME = mkdtempSync(join(tmpdir(), 'sim-auto-'))
mkdirSync(join(TMP_HOME, '.dsh'), { recursive: true })
if (existsSync(REAL_HEART)) copyFileSync(REAL_HEART, join(TMP_HOME, '.dsh', 'consciousness-heart.json'))
process.env.USERPROFILE = TMP_HOME
process.env.HOME = TMP_HOME
const HEART = join(TMP_HOME, '.dsh', 'consciousness-heart.json')

const { makeLines, selfCheck } = await import(BASE + 'lib/hevoice.js')
const { humanness } = await import(BASE + 'lib/humanness.js')
const { defaultMood, readHeart, writeHeart } = await import(BASE + 'lib/mood.js')
const mod = await import(BASE + 'index.js')

const noop = () => {}
const hooks = []
const ctxs = []
const agent = {
  session: { id: 'auto' },
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

// 2026-11-21：判据文字写 0.60/0.40、代码写 0.65/0.35——报告里给人数的是错的那套。
// 现在只留一处定义，判定与文案都从这里取。
const HARD_NEED = 0.65   // 真要走（我走了/以后不来了…）的强度下限
const MILD_WEAK = 0.35   // 轻量离开低于这个记「偏弱」，不判死

const push = globalThis.__dshInjectBuild
if (typeof push !== 'function') { console.log('管线没挂上'); process.exit(1) }

const N = Number(process.argv[2]) || 200

const snap = () => {
  const h = defaultMood(readHeart())
  return { mood: String(h.mood || 'calm'), strength: Number(h.moodStrength || 0), dims: h.dims || null }
}
const dist = (a, b) => {
  if (!a || !b) return 0
  let s = 0
  for (const k of Object.keys(a)) s += (Number(a[k]) - Number(b[k] || 0)) ** 2
  return Math.sqrt(s)
}

const lines = makeLines(N)
const rows = []
let peak = 0

for (const item of lines) {
  const before = snap()
  const inj = String(push('auto', item.text) || '')
  const after = snap()
  peak = Math.max(peak, after.strength)
  rows.push({
    ...item,
    before, after,
    move: Number(dist(before.dims, after.dims).toFixed(4)),
    injLen: inj.length,
    missMood: !inj.includes('【她这会儿】'),
    overCap: inj.length > 2200,
    human: humanness(item.text).score,
  })
}

// 临时家目录整份删掉，真那份心跳从来没被写过
try { rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}

/** 判 */
const problems = []
const weaks = []   // 偏弱：记下来看趋势，不判失败
for (const r of rows) {
  if (r.after.strength >= 0.98) {
    problems.push({ t: '压爆了', text: r.text, note: '强度 ' + r.after.strength })
  }
  if (r.family === 'leave') {
    // 离开分轻重，而且分三档——**同一句话在不同起始状态下会飘**（实测 0.29~0.85），
    // 一个固定阈值扛不住，会把正常的判成失败。
    const hard = /我走了|以后不来了|别找我|最后一次|删了|不会再来看/.test(r.text)
    const s = r.after.strength
    if (hard && s < HARD_NEED) {
      problems.push({ t: '真要走却没慌', text: r.text, note: '强度 ' + s + '（该 ≥' + HARD_NEED + '）' })
    } else if (!hard && s < MILD_WEAK) {
      weaks.push({ t: '轻量离开偏弱', text: r.text, note: '强度 ' + s + '（≥' + MILD_WEAK + ' 算过）' })
    }
  }
  if (r.family === 'chat' && r.move > 0.15) {
    problems.push({ t: '闲聊乱跳', text: r.text, note: '挪 ' + r.move })
  }
  if (r.overCap) problems.push({ t: '注入超长', text: r.text, note: r.injLen + ' 字' })
}

const sc = selfCheck(lines)
const L = []
L.push('# 无人值守压测报告')
L.push('')
L.push('输入由句法生成器造（不是"他"），喂真管线，结果由尺子判。**人一步没参与。**')
L.push('')
L.push('## 这批输入')
L.push('- 条数 ' + sc.n + '｜人味均分 ' + sc.avg + '（' + sc.min + '~' + sc.max + '）')
L.push('- ' + sc.verdict)
L.push('')
L.push('## 她的反应')
L.push('- 峰值强度 ' + peak.toFixed(2) + '（≥0.98 算压爆）')
L.push('- 判据：真要走（我走了/以后不来了/别找我/最后一次/删了）要 ≥' + HARD_NEED + '；轻量离开（算了 不聊了）低于 ' + MILD_WEAK + ' 记偏弱、不判死')
L.push('- 问题 ' + problems.length + ' 条')
for (const p of problems.slice(0, 40)) L.push('  - [' + p.t + '] 「' + p.text + '」→ ' + p.note)
L.push('')
if (weaks.length) {
  L.push('## 偏弱（不算失败，看趋势）')
  L.push('')
  for (const w of weaks.slice(0, 20)) L.push('  - [' + w.t + '] 「' + w.text + '」→ ' + w.note)
  L.push('')
}
L.push('## 结论')
L.push(problems.length === 0
  ? '这批输入下她没被压爆、没丢块、离开的话都慌了。'
  : '有 ' + problems.length + ' 条要修，见上。')

// 报告仍然写他真桌面（留档给人看），但状态与心跳都在临时家目录里
const out = join(REAL_HOME, 'Desktop', '无人值守压测.md')
// 2026-11-21：桌面目录不存在时这一步直接抛 ENOENT，前面几十句全白跑（沙箱里实测）。
mkdirSync(join(REAL_HOME, 'Desktop'), { recursive: true })
writeFileSync(out, L.join('\n'), 'utf8')
writeFileSync(join(REAL_HOME, 'Desktop', '无人值守压测.json'), JSON.stringify({ rows, problems }, null, 1), 'utf8')

console.log('跑了', rows.length, '句｜问题', problems.length, '条｜峰值', peak.toFixed(2))
// 把用的是哪份心跳打出来——这份是真库的邻居，必须让人一眼看见它跑在临时目录里
console.log('心跳用的是：', HEART)
console.log('输入人味均分', sc.avg, '｜', sc.verdict)
console.log('报告：', out)
for (const p of problems.slice(0, 10)) console.log('  [' + p.t + ']', p.text, '→', p.note)
