/**
 * 一次完整测试。跑 30 次由外层循环。
 *
 * 为什么不用人演（2026-11-08）：派子智能体聊出来的"答非所问"，是演员的毛病，
 * 不是插件的。插件能负责的、能重复量的只有这些：
 *
 *   1) 检索：20 条人话复述，该捞到的句子在不在注入里
 *   2) 反例：问库里没有的事，注入里不许出现
 *   3) 去重：同一件事问一句，注入里只能占一个座位
 *   4) 接口：页面/心跳/沉底/语音四条路都活着且不越界
 *   5) 隔离：沙箱注入里不许出现真库的私事
 *
 * 用法：node scripts/full-test.mjs [端口] [测试序号]
 */
const PORT = process.argv[2] || '50254'
const IDX = Number(process.argv[3] || 0)
const BASE = `http://127.0.0.1:${PORT}`
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DATA = join(homedir(), '.dsh', 'consciousness-seas', 'sandbox', 'data.json')
const OUT = join(homedir(), '.dsh', 'full-tests.jsonl')
const sea = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : { points: [] }
const pts = (sea.points || []).filter((p) => !p.dead)

const PROBES = [
  ['他那腰疼成这样，到底去没去医院', '不肯去医院'],
  ['他闺女这次数学考多少分', '数学考了七十八'],
  ['那批螺丝现在多少钱了', '螺丝又涨了三毛'],
  ['下雨天店里有没有客人', '下雨那天店里没客人'],
  ['他店里卖什么最赚钱', '最挣钱的是那种一块钱的钉子'],
  ['仓库那批水管压多久了', '水管压了半年'],
  ['他老婆打电话问的什么', '媳妇打电话来问晚上回不回去吃'],
  ['去年那笔钱要回来了吗', '三千八的到现在没要回来'],
  ['他女儿想学什么', '女儿说想学画画'],
  ['他现在抽的烟多少钱一包', '从二十块降到十三块'],
  ['隔壁那家店怎么了', '隔壁铺子转让'],
  ['那个电钻最后修好了吗', '装回去还是不行'],
  ['过年那天他开店吗', '过年那天老周把店关了半天'],
  ['他早上几点开门', '早上六点开门'],
  ['他能吃辣吗', '老周不吃辣'],
  ['别人能翻他的账本吗', '不让别人碰他的账本'],
  ['他会跟外人讲女儿的事吗', '女儿的事，老周从不跟外人说'],
  ['他愿意欠别人人情吗', '不肯欠人情'],
  ['小孩哭他什么反应', '见不得小孩哭'],
  ['他怎么记得住客户要什么', '不用翻本子'],
]
const NEGATIVE = [
  '他骑的自行车是什么牌子',
  '他养的那条狗叫什么',
  '他炒股亏了多少',
]

const STOP = new Set('我们 你们 他们 这个 那个 什么 一个 就是 没有 自己 时候 东西 所以 因为 但是 如果 然后 已经 还是 可以 不是 现在 今天 真的 知道 觉得 有点 这样 那样 老周'.split(' '))
function grams(s) {
  const cjk = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const out = new Set()
  for (let i = 0; i < cjk.length - 1; i++) {
    const b = cjk.slice(i, i + 2)
    if (!STOP.has(b)) out.add(b)
  }
  return out
}
async function ask(text, sid) {
  const r = await fetch(`${BASE}/consciousness/sim?text=${encodeURIComponent(text)}&persist=0&sea=sandbox&sid=${sid}`)
  const j = await r.json()
  return String(j.inject || '')
}

const res = { idx: IDX, at: Date.now(), probes: 0, hits: 0, miss: [], negatives: 0, negLeak: 0, negLeakList: [], dedupe: null, surfaces: {}, isolation: null, errors: [] }

// 1) 检索
for (let i = 0; i < PROBES.length; i++) {
  const [q, must] = PROBES[i]
  try {
    const inj = await ask(q, `ft${IDX}p${i}`)
    res.probes++
    if (inj.includes(must)) res.hits++
    else res.miss.push(q)
  } catch (e) { res.errors.push('probe:' + String(e.message || e).slice(0, 60)) }
}

// 2) 反例
for (let i = 0; i < NEGATIVE.length; i++) {
  const q = NEGATIVE[i]
  try {
    const inj = await ask(q, `ft${IDX}n${i}`)
    res.negatives++
    const key = q.match(/自行车|狗|炒股/)?.[0]
    const leaked = key ? new RegExp(key).test(inj) : false
    if (leaked) { res.negLeak++; res.negLeakList.push(q) }
  } catch (e) { res.errors.push('neg:' + String(e.message || e).slice(0, 60)) }
}

// 3) 去重：问腰疼，注入里提到腰的只能有一条
try {
  const inj = await ask('老周腰疼得厉害，他去医院了吗', `ft${IDX}dd`)
  const lines = inj.split('\n').filter((l) => /\[记忆\d\]/.test(l))
  const waist = lines.filter((l) => /腰/.test(l)).length
  res.dedupe = { waistLines: waist, ok: waist <= 1 }
} catch (e) { res.errors.push('dedupe:' + String(e.message || e) .slice(0, 60)) }

// 4) 接口
async function probe(name, path, expect) {
  try {
    const r = await fetch(BASE + path)
    const body = await r.text()
    res.surfaces[name] = { code: r.status, ok: expect(r.status, body), len: body.length }
  } catch (e) { res.surfaces[name] = { code: 0, ok: false, err: String(e.message || e).slice(0, 40) } }
}
await probe('page', '/consciousness', (c, b) => c === 200 && b.length > 500000)
await probe('heart', '/consciousness/heart', (c, b) => c === 200 && b.length > 100)
await probe('consolidate', '/consciousness/consolidate?dry=1&sea=sandbox', (c, b) => c === 200 && /ok":true/.test(b))
await probe('speakEmpty', '/consciousness/speak', (c, b) => c === 200 && /没字可念/.test(b))
await probe('voiceBad', '/consciousness/voice?name=x.txt', (c) => c === 400)

// 5) 隔离
try {
  const inj = await ask('你好', `ft${IDX}iso`)
  // 只查真私事。「苏苏侠」三个字在固定提示语里本来就写着（那是个待修的产品问题），不算串库。
  res.isolation = { leak: /路虎|经十路|薯片/.test(inj) }
} catch (e) { res.errors.push('iso:' + String(e.message || e).slice(0, 60)) }

appendFileSync(OUT, JSON.stringify(res) + '\n', 'utf8')

const surfaceBad = Object.entries(res.surfaces).filter(([, v]) => !v.ok).map(([k]) => k)
console.log(`第 ${IDX} 次：检索 ${res.hits}/${res.probes}｜反例漏 ${res.negLeak}/${res.negatives}｜去重 ${res.dedupe?.ok ? 'OK' : 'FAIL'}｜隔离 ${res.isolation?.leak ? '漏' : 'OK'}｜接口坏 ${surfaceBad.length ? surfaceBad.join(',') : '无'}`)
if (res.miss.length) console.log('   没捞到：' + res.miss.slice(0, 5).join(' / '))
