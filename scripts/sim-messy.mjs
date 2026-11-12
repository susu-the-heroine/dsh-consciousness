/**
 * 手滑输入：人不会打干净句子
 * ========================
 * 真人说话/打字会：打错字（同音）、插语气词、倒装、拆成几条、重复、
 * 漏标点、突然断掉、全大写、夹英文、夹表情符号。
 *
 * 这个脚本把他的话弄脏，再喂真管线，看注入会不会丢块、超长、抛错，
 * 情绪会不会被脏输入带飞。
 *
 * 跑法：node scripts/sim-messy.mjs [条数]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const store = await import(BASE + 'lib/store.js')
const mod = await import(BASE + 'index.js')

const noop = () => {}
const hooks = []
const ctxs = []
const agent = {
  session: { id: 'sim-messy' },
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

/** 同音错字：只换几个常用的，别太多 */
const TYPO = [
  ['的', '得'], ['在', '再'], ['做', '作'], ['那', '哪'], ['么', '吗'],
  ['是', '事'], ['他', '她'], ['累', '类'], ['看', '砍'], ['会', '回'],
  ['都', '兜'], ['就', '旧'], ['说', '说'], ['想', '相'],
]
/** 口语填充 */
const FILL = ['那个', '就是', '怎么说呢', '嗯', '啊对', '卧槽', '你懂吧', '反正']
/** 表情 */
const EMOJI = ['😂', '😅', '🥲', '👍', '…', '。。。']

let seed = 20261108
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

/** 弄脏 */
function mess(text, level) {
  let t = String(text || '').trim()
  if (!t) return t
  const ops = []
  // 打错字
  if (rnd() < 0.55) {
    const [a, b] = pick(TYPO)
    if (t.includes(a)) t = t.replace(a, b)
    ops.push('错字')
  }
  // 插语气词
  if (rnd() < 0.5) {
    const i = Math.floor(rnd() * Math.max(1, t.length - 1))
    t = t.slice(0, i) + pick(FILL) + t.slice(i)
    ops.push('语气词')
  }
  // 倒装：把最后一句挪到前面
  if (rnd() < 0.3 && t.length > 8) {
    const half = Math.floor(t.length / 2)
    t = t.slice(half) + t.slice(0, half)
    ops.push('倒装')
  }
  // 拆成两条
  if (rnd() < 0.35 && t.length > 6) {
    const i = Math.floor(t.length / 2)
    t = t.slice(0, i) + '\n' + t.slice(i)
    ops.push('拆句')
  }
  // 重复
  if (rnd() < 0.25) {
    const w = t.slice(0, Math.min(4, t.length))
    t = t + ' ' + w
    ops.push('重复')
  }
  // 漏标点
  if (rnd() < 0.4) {
    t = t.replace(/[，。！？、；：]/g, ' ')
    ops.push('漏标点')
  }
  // 突然断掉
  if (rnd() < 0.2 && t.length > 8) {
    t = t.slice(0, Math.floor(t.length * 0.6))
    ops.push('断掉')
  }
  // 夹表情/英文
  if (rnd() < 0.2) {
    t = t + ' ' + pick(EMOJI)
    ops.push('表情')
  }
  if (rnd() < 0.12) {
    t = t.replace(/[\u4e00-\u9fa5]{1,4}/, (w) => w.toUpperCase() === w ? w : 'AI')
    ops.push('夹英文')
  }
  return t.slice(0, 120)
}

// 原料：他自己的话 + 记忆标题（都是干净句子）
const sea = store.readSea('main')
const clean = []
for (const p of (sea.points || []).filter((x) => !x.dead)) {
  clean.push(String(p.title || ''))
  const hs = p.herSide || {}
  for (const k of ['felt', 'did']) if (hs[k]) clean.push(String(hs[k]))
}
for (const f of readdirSync(join(homedir(), '.dsh', '记忆'))) {
  if (!f.endsWith('.md') || f.startsWith('_')) continue
  const t = readFileSync(join(homedir(), '.dsh', '记忆', f), 'utf8')
  for (const m of t.matchAll(/[“「]([^”」\n]{6,40})[”」]/g)) clean.push(m[1].trim())
}
const uniq = [...new Set(clean)].filter((x) => [...x].length >= 4)

const N = Number(process.argv[2]) || 200
const problems = []
let ok = 0

for (let i = 0; i < N; i++) {
  const base = pick(uniq)
  const dirty = mess(base)
  if (!dirty) continue
  let out = null
  try {
    out = build('sim-messy', dirty)
  } catch (e) {
    problems.push({ t: '抛错', text: dirty, note: String((e && e.message) || e).slice(0, 80) })
    continue
  }
  if (typeof out !== 'string' || !out.length) {
    problems.push({ t: '注入为空', text: dirty, note: typeof out })
    continue
  }
  ok++
  for (const must of ['【识海', '【她这会儿】']) {
    if (!out.includes(must)) { problems.push({ t: '缺「' + must + '」', text: dirty, note: 'len=' + out.length }); break }
  }
  if (out.length > 2600) problems.push({ t: '超长', text: dirty, note: 'len=' + out.length })
  if (out.length < 200) problems.push({ t: '过短', text: dirty, note: 'len=' + out.length })
  // 脏输入不该把情绪顶到 85% 以上——那是"一句话把人点燃"，不真实
  const m = out.match(/【她这会儿】[^（\n]*（(\d+)%）/)
  if (m && Number(m[1]) >= 85) problems.push({ t: '一句脏话点燃到 ' + m[1] + '%', text: dirty, note: '' })
}

console.log('脏输入测试：', N, '条（错字/语气词/倒装/拆句/重复/漏标点/断掉/表情/夹英文）')
console.log('  正常', ok, '｜问题', problems.length)
for (const p of problems.slice(0, 12)) console.log('  [' + p.t + '] 「' + String(p.text).slice(0, 34) + '」 ' + p.note)
if (!problems.length) console.log('  一条问题都没有。')
