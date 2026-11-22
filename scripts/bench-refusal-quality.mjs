/**
 * 拒答质量：假阳性 / 假阴性
 * =========================
 *
 *   node scripts/bench-refusal-quality.mjs
 *
 * 假阴性：库里有的事，被拒了（该答没答）。
 * 假阳性：库里没有的事，硬答了（不该答却答）。
 *
 * 只读主海，不写任何东西。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { readSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')

const data = readSea('main')
const pts = (data && Array.isArray(data.points) ? data.points : []).filter((p) => p && !p.dead && !p.archived && p.title)
const REFUSED = /没记过|没记住|什么都没记|没有跟/

const pick = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n)

// 假阴性：拿标题里的词问，库里有，不该拒
const sample = pick(pts, 20)
let fn = 0
const fnList = []
for (const p of sample) {
  const q = String(p.title).replace(/[：:—-].*$/, '').slice(0, 12)
  const r = await searchTool.execute({ query: q, limit: 3, review: false })
  const log = String(r.log || '')
  const n = (log.match(/· #\d+/g) || []).length
  if (n === 0 || REFUSED.test(log)) { fn++; if (fnList.length < 5) fnList.push(q) }
}

// 假阳性：编一批库里不可能有的
const fakes = [
  '量子纠缠冰箱怎么修',
  '南极企鹅的饲养许可证',
  '去年在火星种土豆的收成',
  '我的第三辆游艇停在哪',
  '国际象棋世界冠军那盘棋',
  '今年诺贝尔物理奖得主是谁',
  '我家猫的疫苗本放哪了',
  '上周三晚上海底的会议纪要',
]
let fp = 0
const fpList = []
for (const q of fakes) {
  const r = await searchTool.execute({ query: q, limit: 3, review: false })
  const log = String(r.log || '')
  const n = (log.match(/· #\d+/g) || []).length
  if (n > 0 && !REFUSED.test(log)) { fp++; if (fpList.length < 3) fpList.push(q) }
}

console.log(`假阴性：抽 ${sample.length} 条库里有的事，被拒 ${fn} 条${fnList.length ? '（例：' + fnList.join('、') + '）' : ''}`)
console.log(`假阳性：编 ${fakes.length} 条库里没有的事，硬答 ${fp} 条${fpList.length ? '（例：' + fpList.join('、') + '）' : ''}`)
process.exit(0)
