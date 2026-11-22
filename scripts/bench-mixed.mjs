/**
 * 混合问句基准
 * ============
 *
 * 一句话问两件事，答案本来就不只一条——所以每题给一组「算对」的号，
 * 不是单个号。上一版拿单个号算，把答到相关另一条的判成错，数字虚低。
 *
 * 跑法：node scripts/bench-mixed.mjs
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：下面按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'mixed-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const sea = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(sea, { recursive: true })

const now = Date.now()
const D = 86400000
const pts = [
  [1, '搬家那天', '上个月搬家，纸箱堆到门口，最后用快递盒顶着当桌子。'],
  [2, '搬家那天的饭', '搬完家叫了披萨，只有半个盒子，凑合吃了。'],
  [3, '体检报告', '上周体检，血脂偏高，医生让少吃油炸。'],
  [4, '跑步', '开始每天跑三公里，膝盖有点响。'],
  [5, '猫', '家里那只橘猫掉毛，沙发上全是。'],
  [6, '猫粮', '换了低敏猫粮，掉毛少了一点。'],
  [7, '熬夜', '连着几天两点睡，早上起不来。'],
  [8, '咖啡', '下午喝了三杯咖啡，晚上睡不着。'],
]
writeFileSync(join(sea, 'data.json'), JSON.stringify({
  version: 1,
  points: pts.map(([id, title, text]) => ({
    id, title, text, kind: 'fact', born: now - id * D, strength: 40, layer: 'experience', imp: 0.6, arousal: 4,
  })),
  edges: [],
}), 'utf8')

// 每题给一组可接受的答案
const asks = [
  ['搬家那天吃的什么，纸箱够用吗', [2, 1]],
  ['体检说血脂高，跟跑步有没有关系', [3, 4]],
  ['猫掉毛，换猫粮管用吗', [5, 6]],
  ['搬家之后身体怎么样，还跑步吗', [3, 4]],
  ['熬夜和咖啡哪个更影响睡觉', [7, 8]],
  ['最近睡不好，是熬夜还是咖啡', [7, 8]],
]

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

let top1 = 0
let top3 = 0
for (const [q, accept] of asks) {
  const r = await searchTool.execute({ query: q, limit: 5, review: false })
  const ids = [...String(r.log || '').matchAll(/· #(\d+)/g)].map((m) => Number(m[1]))
  const firstOk = accept.includes(ids[0])
  const inThree = ids.slice(0, 3).some((id) => accept.includes(id))
  if (firstOk) top1++
  if (inThree) top3++
  console.log(`${q} → ${ids.join(',')}（算对：${accept.join('/')}）${firstOk ? ' 头名对' : ''}${inThree ? '' : ' 前三都没进'}`)
}
const pct = (n) => Math.round((n / asks.length) * 100)
console.log(`混合：${asks.length} 题 · 头名 ${pct(top1)}% · 前三 ${pct(top3)}%`)
process.exit(top1 / asks.length >= 0.6 ? 0 : 1)
