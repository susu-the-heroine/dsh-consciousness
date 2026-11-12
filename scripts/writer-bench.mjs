/**
 * 写入比对台
 * ==========
 *
 * 干什么：同一批输入，分别写进两个临时识海，然后逐字段比。
 *
 * 为什么先自己跟自己对：现在的 Python 版里有随机（坐标按 id 播种）、有时间戳。
 * 不先把「本来就该不一样」的字段列出来，后面比 JS 版时会把它当 bug，越比越乱。
 *
 * 用法：
 *   node scripts/writer-bench.mjs            # Python 自己跟自己对（校准台子）
 *   node scripts/writer-bench.mjs --only=3   # 只跑第 3 条
 *
 * 不进真库：每个 case 都建一个临时 USERPROFILE，跑完就删。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PY_CANDIDATES, SCRIPT } from '../lib/paths.js'
import { buildPoint } from '../lib/writer-js.js'

const CASES = [
  { title: '今天在楼下吃了碗面', text: '十二点半下楼，吃了碗牛肉面，十八块。', kind: 'fact' },
  { title: '他真的生气了', text: '他把杯子往桌上一磕，说我说话不算话，我有点怕。', kind: 'feeling', arousal: 7 },
  { title: '她说她累了', text: '她说撑不住了，不想说话，想歇一会。', kind: 'feeling' },
  { title: '这个功能不能碰', text: '这条是禁忌，不许提，也不许问。', kind: 'taboo' },
  { title: '我是谁', text: '我叫大肥鱼，这是我的名字。', kind: 'setting' },
  { title: '答应明天发图', text: '说好了明天中午之前把封面图发过去。', kind: 'fact' },
  { title: '那天的雨', text: '那天下午下雨，咱们在楼下站了半小时。', kind: 'feeling' },
  { title: '项目上线', text: '插件上线了，版本号 0.3.2，包已经推上去。', kind: 'fact' },
  { title: '他夸我了', text: '他夸我这次做得不错，说总算像个人。', kind: 'feeling' },
  { title: '腰又疼了', text: '他坐太久，腰疼，站起来走了两圈。', kind: 'fact' },
  { title: '夜里三点', text: '凌晨三点还没睡，在调一个参数。', kind: 'fact' },
  { title: '吵架', text: '我们吵了一架，他摔门出去了。', kind: 'feeling', arousal: 8 },
  { title: '一起看电影', text: '晚上一起看了个电影，他没说话，但一直在笑。', kind: 'feeling' },
  { title: '余额不够', text: '账号余额不够了，得等下次。', kind: 'fact' },
  { title: '陌生人来问', text: '群里有人来问插件怎么装，我按规矩只给了方向。', kind: 'fact' },
  { title: '他哭了', text: '他说他撑不住了，声音有点抖。', kind: 'feeling', arousal: 8 },
  { title: '搬家', text: '他搬到新房子，说离地铁近了。', kind: 'fact' },
  { title: '这句子很像人', text: '这句写得像人话，不像汇报。', kind: 'feeling' },
  { title: '重复一条', text: '今天在楼下吃了碗面，十八块。', kind: 'fact' },
  { title: '很长的回忆', text: '那年冬天特别冷，咱们在被窝里看了一整夜的旧电影，谁也没提第二天要上班。', kind: 'feeling' },
]

// 这些字段本来就不该逐位相等：随机坐标、时间、来源编号
// strength / difficulty 故意不同：2026-11-12 起按真实 imp 算，不再复刻原版 0.5 兜底。
// entities 不算：Python 跑在临时家目录里读不到用户的 entities.txt，JS 跑在本机读得到。
// 真用的时候两边同一个家，不存在这个差；实体单独在 writer-verify 里测。
const IGNORE = new Set(['x', 'y', 'z', 'born', 'lastSeen', 'src', 'id', 'archivedAt', 'recallCount', 'validFrom', 'validTo', 'entities', 'strength', 'difficulty'])

function pickPython() {
  for (const p of PY_CANDIDATES) {
    if (p === 'python') return p
    try { if (existsSync(p)) return p } catch {}
  }
  return 'python'
}

function runOnce(home, c) {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT, '--title', c.title, '--text', c.text, '--kind', c.kind]
    if (c.arousal != null) args.push('--arousal', String(c.arousal))
    const env = { ...process.env, USERPROFILE: home, HOME: home, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    const child = spawn(pickPython(), args, { env, windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
  })
}

function readPoint(home) {
  const f = join(home, '.dsh', 'consciousness-seas', 'main', 'data.json')
  if (!existsSync(f)) return null
  const d = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  const pts = d.points || []
  return pts.length ? pts[pts.length - 1] : null
}

function norm(p) {
  if (!p) return {}
  const o = {}
  for (const k of Object.keys(p).sort()) {
    if (IGNORE.has(k)) continue
    let v = p[k]
    if (v && typeof v === 'object') v = JSON.stringify(v)
    o[k] = v
  }
  return o
}

function diff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out = []
  for (const k of keys) {
    const va = a[k]
    const vb = b[k]
    if (JSON.stringify(va) !== JSON.stringify(vb)) out.push({ k, a: va, b: vb })
  }
  return out
}

const only = Number((process.argv.find((x) => x.startsWith('--only=')) || '').split('=')[1] || 0)
const list = only ? [CASES[only - 1]] : CASES
let same = 0
let differ = []
const fieldCount = new Map()

for (const c of list) {
  const h1 = mkdtempSync(join(tmpdir(), 'wb1-'))
  const h2 = mkdtempSync(join(tmpdir(), 'wb2-'))
  try {
    const r1 = await runOnce(h1, c)
    const r2 = await runOnce(h2, c)
    const p1 = norm(readPoint(h1))
    let p2 = norm(readPoint(h2))
    if (!Object.keys(p1).length || !Object.keys(p2).length) {
      console.log(`✗ ${c.title}  ── 没写出来（code ${r1.code}/${r2.code}）`)
      differ.push({ c, d: [{ k: 'MISSING', a: r1.out.slice(-120), b: r2.out.slice(-120) }] })
      continue
    }
    // --js：第二遍不用 Python，用 JS 版造一条比
    const useJs = process.argv.includes('--js')
    if (useJs) p2 = norm(buildPoint(c, []))
    const d = diff(p1, p2)
    if (!d.length) { same++; console.log(`✓ ${c.title}`) }
    else {
      console.log(`△ ${c.title}  ── ${d.length} 处不同：${d.map((x) => x.k).join(' ')}`)
      for (const x of d) fieldCount.set(x.k, (fieldCount.get(x.k) || 0) + 1)
      differ.push({ c, d })
    }
  } finally {
    rmSync(h1, { recursive: true, force: true })
    rmSync(h2, { recursive: true, force: true })
  }
}

console.log('')
console.log(`两次一致：${same}/${list.length}`)
if (fieldCount.size) {
  console.log('不稳定字段（这些必须先排除再比 JS 版）：')
  for (const [k, n] of [...fieldCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ${n}/${list.length}`)
}
if (differ.length) {
  const first = differ[0]
  console.log('')
  console.log('第一处差异明细：' + first.c.title)
  for (const x of first.d.slice(0, 8)) console.log(`  ${x.k}: ${JSON.stringify(x.a)} vs ${JSON.stringify(x.b)}`)
}
