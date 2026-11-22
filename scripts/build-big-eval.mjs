/**
 * 大评测题库生成器
 * =================
 *
 * 目标：三百道以上，三套分开（调参/验收/盲测），题面分三类：
 *   题型 A：标题问法（"XX，这是哪件事"）——量字面稳不稳
 *   题型 B：同音错字（用拼音表换一个字）——量拼音这条道真不真
 *   题型 C：反例（库里没有的东西）——量会不会硬塞
 * 外加把旧留出集（recall-holdout）里目标还活着的题并进来。
 *
 * 只读主库，不发版。
 * 跑法：node scripts/build-big-eval.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MAP = (await import('file:///' + join(HERE, '..', 'lib', 'pinyin-map.js').replace(/\\/g, '/'))).default

const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const dataPath = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
const points = (data.points || []).filter((p) => p && !p.dead && p.id != null)
const alive = new Set(points.map((p) => p.id))

function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
const splitOf = (q) => ['tune', 'accept', 'blind'][hash(q) % 3]

// ---- 反向索引：拼音 -> 若干常用字 ----
const rev = new Map()
for (const [ch, py] of Object.entries(MAP)) {
  if (!/[\u4e00-\u9fa5]/.test(ch)) continue
  if (!rev.has(py)) rev.set(py, [])
  const arr = rev.get(py)
  if (arr.length < 40) arr.push(ch)
}

const cases = []
const seen = new Set()
function push(q, want, kind) {
  const key = String(q)
  if (!key || seen.has(key)) return
  seen.add(key)
  cases.push({ q: key, want: want ?? null, kind, split: splitOf(key) })
}

// ---- 旧留出集并进来 ----
try {
  const hs = JSON.parse(readFileSync(join(HERE, 'data', 'recall-holdout.json'), 'utf8')).cases
  for (const c of hs) {
    if (!c || !c.q) continue
    if (c.want == null) push(c.q, null, 'neg')
    else if (alive.has(Number(c.want))) push(c.q, Number(c.want), 'holdout')
  }
} catch {}

// ---- 题型 A：标题问法（每个点最多一条，取前 260 个有标题的） ----
const titled = points
  .map((p) => ({ id: Number(p.id), t: String(p.title || '').trim() }))
  .filter((x) => x.t.length >= 6 && /[\u4e00-\u9fa5]/.test(x.t))
  .slice(0, 280)
for (const x of titled) {
  push(`${x.t}——这是哪件事？`, x.id, 'title')
}

// ---- 题型 A2：换个说法问同一批（前 60 个），量换说法稳不稳 ----
for (const x of titled.slice(0, 60)) {
  push(`${x.t}，你还记得吗？`, x.id, 'title2')
}

// ---- 题型 B：同音错字（抽 30 个点，换一个同音字） ----
let typoN = 0
for (const x of titled) {
  if (typoN >= 30) break
  let q = null
  for (let i = 0; i < x.t.length; i++) {
    const ch = x.t[i]
    const py = MAP[ch]
    if (!py) continue
    const alts = (rev.get(py) || []).filter((c) => c !== ch)
    if (!alts.length) continue
    const alt = alts[hash(x.t + i) % alts.length]
    q = x.t.slice(0, i) + alt + x.t.slice(i + 1) + '——这是哪件事？'
    break
  }
  if (q) {
    push(q, x.id, 'typo')
    typoN++
  }
}

// ---- 题型 C：反例（库里没有的） ----
const NEG = [
  '他养的那只蜥蜴叫什么名字',
  '他去年去冰岛住的哪家酒店',
  '他外婆家的门牌号是多少',
  '他公司年会的抽奖程序是谁写的',
  '他那只猫打疫苗的医院叫什么',
  '他学驾照科目二考了几次',
  '他大学室友的外号是什么',
  '他高中班主任姓什么',
  '他第一次坐飞机的航班号',
  '他那辆自行车是什么牌子的',
  '他做的那道菜放了几克盐',
  '他吉他弹到第几级了',
  '他家楼下便利店老板叫什么',
  '他买的基金年化收益率是多少',
  '他种的绿萝浇了几次水',
  '他手机壳是哪家店买的',
  '他看的那场演出票价多少',
  '他背的单词书是哪一版',
  '他办的那张卡的卡号尾数',
  '他跑步用的什么牌子的跑鞋',
  '他上次理发花了多少钱',
  '他家的路由器管理密码是多少',
  '他报名的那场考试的考点在哪',
  '他坐的那趟高铁是几车几座',
  '他送给朋友的礼物是什么牌子',
  '他修的那台电脑换了几块硬盘',
  '他拍的那张照片用的什么镜头',
  '他早上喝的那杯豆浆加没加糖',
  '他出差住的那间房朝南还是朝北',
  '他上周买的洗衣液是什么牌子',
  '他电脑显示器的刷新率是多少',
  '他上个月体检的血压是多少',
  '他家花洒是哪个型号',
  '他点的外卖备注写了什么',
  '他背的那本词书第几页有折角',
  '他停车那格的车位号码是多少',
  '他订的牛奶每天几点送到',
  '他健身房的私教姓什么',
  '他用的那把键盘是什么轴',
  '他报名的比赛是第几组',
  '他上次看牙去的是哪家诊所',
]
for (const q of NEG) push(q, null, 'neg')

const out = {
  _说明: `大评测题库（${new Date().toISOString()} 生成）。三类题：title/typo/neg；split 用题面哈希定，固定不动。want 是目标条目 id，null 表示反例。tune 用来调参，accept 用来看收益，blind 平时不看。`,
  sea,
  cases,
}
const outPath = join(HERE, 'data', 'big-eval.json')
writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8')

const by = { tune: 0, accept: 0, blind: 0 }
// 2026-11-21：「换个说法」那一类（title2）以前漏在账外，末尾按类一加总就对不上总题数，
// 看的人会以为没有这一类。补进来。
const byKind = { title: 0, title2: 0, typo: 0, neg: 0, holdout: 0 }
for (const c of cases) {
  by[c.split]++
  if (c.kind in byKind) byKind[c.kind]++
}
console.log(`题 ${cases.length} 道 -> ${outPath}`)
console.log(`按套：tune ${by.tune} / accept ${by.accept} / blind ${by.blind}`)
console.log(`按类：title ${byKind.title} / title2 ${byKind.title2} / typo ${byKind.typo} / holdout ${byKind.holdout} / neg ${byKind.neg}`)
