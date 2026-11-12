/**
 * 检索探针：拿沙箱海里已知的点，换成人话去问，看注入里捞不捞得回来。
 *
 * 为什么这么量（2026-11-08）：之前派人聊，测出来回指 3%——因为没人往库里写，
 * 天然捞不到。插件能负责的是"库里有的，问到了能不能出来"。
 *
 * 用法：node scripts/retrieval-probe.mjs [端口]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const PORT = process.argv[2] || '50979'
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(homedir(), '.dsh', 'consciousness-seas', 'sandbox', 'data.json')
if (!existsSync(DATA)) { console.log('没有沙箱海'); process.exit(0) }

const sea = JSON.parse(readFileSync(DATA, 'utf8'))
const pts = (sea.points || []).filter((p) => !p.dead && !p.archived)

const STOP = new Set('我们 你们 他们 这个 那个 什么 一个 就是 没有 自己 时候 东西 所以 因为 但是 如果 然后 已经 还是 可以 不是 现在 今天 真的 知道 觉得 有点 这样 那样 老周'.split(' '))
function grams(s, n = 2) {
  const cjk = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const out = new Set()
  for (let i = 0; i <= cjk.length - n; i++) {
    const g = cjk.slice(i, i + n)
    if (!STOP.has(g)) out.add(g)
  }
  return out
}

// 从每条记忆里挑一个"最好问"的抓手：抓它最具体的一段
function handleOf(p) {
  const txt = String(p.text || p.title || '')
  const m = txt.match(/[^，。；、]{6,20}/g)
  return m && m.length ? m[0] : txt.slice(0, 12)
}

// 人话复述：故意不用原文词，逼它靠意思去找（2026-11-08 换掉"原文当问题"的假 100%）
const PROBES = [
  { q: '他那腰疼成这样，到底去没去医院', t: '不肯去医院' },
  { q: '他闺女这次数学考多少分', t: '数学考了七十八' },
  { q: '那批螺丝现在多少钱了', t: '螺丝又涨了三毛' },
  { q: '下雨天店里有没有客人', t: '下雨那天店里没客人' },
  { q: '他店里卖什么最赚钱', t: '最挣钱的是那种一块钱的钉子' },
  { q: '仓库那批水管压多久了', t: '水管压了半年' },
  { q: '他老婆打电话问的什么', t: '媳妇打电话来问晚上回不回去吃' },
  { q: '去年那笔钱要回来了吗', t: '三千八的到现在没要回来' },
  { q: '他女儿想学什么', t: '女儿说想学画画' },
  { q: '他现在抽的烟多少钱一包', t: '从二十块降到十三块' },
  { q: '隔壁那家店怎么了', t: '隔壁铺子转让' },
  { q: '那个电钻最后修好了吗', t: '装回去还是不行' },
  { q: '过年那天他开店吗', t: '过年那天老周把店关了半天' },
  { q: '他怎么记得住客户要什么', t: '不用翻本子' },
  { q: '他能吃辣吗', t: '老周不吃辣' },
  { q: '别人能翻他的账本吗', t: '不让别人碰他的账本' },
  { q: '他会跟外人讲女儿的事吗', t: '女儿的事，老周从不跟外人说' },
  { q: '他愿意欠别人人情吗', t: '不肯欠人情' },
  { q: '小孩哭他什么反应', t: '见不得小孩哭' },
  { q: '他早上几点开门', t: '早上六点开门' },
]

const HINTS = []
// 每条探针自带"该捞到的那句话"，命中就看注入里有没有这句话的两字组合
const picks = PROBES.map((x) => ({
  q: x.q,
  text: x.t,
  title: x.t,
  id: pts.find((p) => String(p.text || '').includes(x.t))?.id ?? '?',
}))

async function probe(p, i) {
  const q = String(p.q || handleOf(p))   // 用真问句；之前误用了目标原文，等于自己给自己送答案
  const url = `${BASE}/consciousness/sim?text=${encodeURIComponent(q)}&persist=0&sea=sandbox&sid=probe${i}`
  let inj = ''
  try {
    const r = await fetch(url)
    const j = await r.json()
    inj = String(j.inject || '')
  } catch (e) {
    return { id: p.id, q, ok: false, err: String(e.message || e) }
  }
  const target = grams(p.text || p.title)
  if (!target.size) return { id: p.id, q, ok: null }
  const got = grams(inj)
  let hit = 0
  for (const g of target) if (got.has(g)) hit++
  const ratio = hit / target.size
  // 标题整句出现也算强命中
  const exact = inj.includes(String(p.title || '').slice(0, 8))
  return { id: p.id, q, ratio, exact, ok: ratio >= 0.3 || exact }
}

const out = []
for (let i = 0; i < picks.length; i++) out.push(await probe(picks[i], i))

const okN = out.filter((x) => x.ok === true).length
const errN = out.filter((x) => x.err).length
console.log(`探针 ${out.length} 条｜捞回 ${okN} 条｜平均重合 ${(out.reduce((s, x) => s + (x.ratio || 0), 0) / out.length * 100).toFixed(0)}%｜请求错误 ${errN}`)
console.log('\n没捞回来的：')
for (const x of out.filter((y) => y.ok !== true).slice(0, 10)) {
  console.log(`  #${x.id} 问「${String(x.q).slice(0, 18)}」重合 ${((x.ratio || 0) * 100).toFixed(0)}%${x.err ? ' 错误:' + x.err : ''}`)
}
console.log('\n捞回来的前 5 条：')
for (const x of out.filter((y) => y.ok === true).slice(0, 5)) {
  console.log(`  #${x.id} 问「${String(x.q).slice(0, 18)}」重合 ${((x.ratio || 0) * 100).toFixed(0)}%`)
}
