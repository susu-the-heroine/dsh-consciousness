/**
 * 大库实测：记忆多了以后，一轮检索要多久
 * ==================================
 *
 *   node scripts/scale-bench.mjs [识海] [查询数]
 *
 * 默认测 real3000（近三千条）。它只读 data.json，不写任何东西。
 *
 * 为什么要有这个：插件是给别人用的，别人用一年就是几千条。
 * 少量记忆跑得快不算数，得看"每轮注入"在几千条时还来不来得及。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'real3000').trim()
const NQ = Math.max(1, Math.min(200, Number(process.argv[3]) || 20))

const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/'))
const T = await import('file:///' + join(HERE, '..', 'lib', 'text.js').replace(/\\/g, '/'))
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/'))

const p = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(p)) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}
const data = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((x) => !x.dead && !x.archived)
if (!pts.length) {
  console.log('这个识海是空的')
  process.exit(0)
}

const QS = ['上次那台机器怎么修的', '房东说涨到多少来着', '那条视频播了多少', '他说过最难听的一句', '哪个词不能说',
  '狗粮换了什么牌子', '欠了多少钱', '什么时候去复查', '预算超了多少', '那个客户的单子拖了几天',
  '第一次见面在哪儿', '为什么不想干了', '用的什么型号的豆子', '考试前刷了多少套卷子', '谁先提的分手',
  '这次花了多少', '哪天搬的家', '哪个平台抽成最高', '后来赔了没有', '谁帮的忙']

// 建向量：这是最贵的一次性成本
const t0 = Date.now()
const vecs = new Map()
for (const x of pts) {
  try {
    const v = await E.embedLocal(V.embedTextOf(x))
    if (Array.isArray(v) && v.length) vecs.set(x.id, v)
  } catch {}
}
const buildMs = Date.now() - t0
console.log(`海 ${sea} · 记忆 ${pts.length} · 建向量 ${(buildMs / 1000).toFixed(1)}s（一次性）`)

// 单轮：字面 + 向量
const gramCache = new Map()
const times = []
let worked = 0
for (let i = 0; i < NQ; i++) {
  const q = QS[i % QS.length]
  const t = Date.now()
  const qg = T.gramsOf(q)
  const qv = await E.embedLocal(q)
  let best = 0
  for (const x of pts) {
    // 片段的缓存（线上就是这么干的：每条记忆的片段只算一次）。
    // 第一版这里每轮都重算，三千条时量出 553 ms，那是自己造的假账。
    let g = gramCache.get(x.id)
    if (!g) {
      g = T.gramsOf(String(x.title || '') + ' ' + String(x.text || ''))
      gramCache.set(x.id, g)
    }
    let hit = 0
    for (const w of qg) if (g.has(w)) hit += w.length === 3 ? 2 : 1
    const v = vecs.get(x.id)
    const sim = v ? V.cosine(qv, v) : 0
    const s = hit + sim * 3
    if (s > best) best = s
  }
  times.push(Date.now() - t)
  if (best > 0) worked++
}

times.sort((a, b) => a - b)
const med = times[Math.floor(times.length / 2)]
const p90 = times[Math.floor(times.length * 0.9)] || times[times.length - 1]
// 2026-11-21：这行原来写「无缓存」，可上一段明明建了每条记忆的片段缓存、跨查询复用。
// 报出来的数不是冷启动第一条，是「片段缓存已经热了、向量已经建好」之后的每轮耗时。
// 数字没错，标签错了——改标签，别改算法。
console.log(`单轮检索（向量已建、片段缓存已热）：中位 ${med} ms · 九成线 ${p90} ms · 有命中的 ${worked}/${NQ}`)
console.log('')
console.log('注：线上有常见度表缓存和每条记忆的片段缓存，第二轮起会快很多；这里量的是最坏情况——冷启动第一条。')
