/**
 * 顺序写入总对照
 * ==============
 *
 * 同一批二十条，Python 连写进一个空库，JS 连写进另一个空库，然后比整库：
 * 条数、每条四十个字段（坐标除外，随机源不同）、全部连边。
 *
 * 跑法：node scripts/seq-bench.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
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

const SKIP = new Set(['x', 'y', 'z', 'born', 'lastSeen', 'validFrom', 'validUntil', 'recallCount', 'entities',  // strength / difficulty 故意不同：按真实 imp 算，见 writer-js 注释
  'strength', 'difficulty'])
const PY = process.env.DSH_TEST_PY
const SCRIPT = join(HERE, '..', 'assets', 'add_memory.py')

function runPython(home, c) {
  const args = [SCRIPT, '--title', c.title, '--text', c.text, '--kind', c.kind]
  if (c.arousal != null) args.push('--arousal', String(c.arousal))
  const r = spawnSync(PY, args, {
    env: { ...process.env, USERPROFILE: home, HOME: home, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
  })
  return r.status
}

function load(home) {
  const f = join(home, '.dsh', 'consciousness-seas', 'main', 'data.json')
  if (!existsSync(f)) return null
  return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
}

const homePy = mkdtempSync(join(tmpdir(), 'seqpy-'))
const homeJs = mkdtempSync(join(tmpdir(), 'seqjs-'))

let pyOk = 0
for (const c of CASES) if (runPython(homePy, c) === 0) pyOk++

process.env.USERPROFILE = homeJs
process.env.HOME = homeJs
const W = await import('file:///' + join(HERE, '..', 'lib', 'write-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

let jsOk = 0
for (const c of CASES) {
  const r = W.writeOne('main', c)
  if (r.ok) jsOk++
  else console.log('JS 写失败:', c.title, r.err)
}

const a = load(homePy)
const b = load(homeJs)
console.log(`Python 写入成功 ${pyOk}/${CASES.length} · JS 写入成功 ${jsOk}/${CASES.length}`)
if (!a || !b) { console.log('有一边没库'); process.exit(1) }

console.log(`条数：Python ${a.points.length} · JS ${b.points.length}`)
console.log(`突触：Python ${a.edges.length} · JS ${b.edges.length}`)

const stat = new Map()
let samePoint = 0
for (let i = 0; i < Math.min(a.points.length, b.points.length); i++) {
  const pa = a.points[i]
  const pb = b.points[i]
  let bad = 0
  for (const k of Object.keys(pa)) {
    if (SKIP.has(k)) continue
    const va = JSON.stringify(pa[k] ?? null)
    const vb = JSON.stringify(pb[k] ?? null)
    if (va !== vb) {
      bad++
      stat.set(k, (stat.get(k) || 0) + 1)
      if (bad <= 3) console.log(`  #${pa.id} ${k}: Python=${va.slice(0, 40)} JS=${vb.slice(0, 40)}`)
    }
  }
  if (!bad) samePoint++
}
console.log(`整条一致：${samePoint}/${Math.min(a.points.length, b.points.length)}`)

const key = (e) => `${e.a}-${e.b}-${e.type}`
const setA = new Set(a.edges.map(key))
const setB = new Set(b.edges.map(key))
const onlyA = [...setA].filter((x) => !setB.has(x))
const onlyB = [...setB].filter((x) => !setA.has(x))
console.log(`边一致：Python 独有 ${onlyA.length} 条 · JS 独有 ${onlyB.length} 条`)
if (onlyA.length) console.log('  Python 独有样例:', onlyA.slice(0, 4))
if (onlyB.length) console.log('  JS 独有样例:', onlyB.slice(0, 4))

rmSync(homePy, { recursive: true, force: true })
rmSync(homeJs, { recursive: true, force: true })
