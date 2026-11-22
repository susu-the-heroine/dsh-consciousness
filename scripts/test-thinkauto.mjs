// 自己会想：跑一次，看它自己挑了哪条线索、想出几种。
//
// 2026-11-21：这份原来直接读真实家目录的海，还会把"想出来的念头"写进真实念头池——
// 实测跑一遍那个文件就重写一次（大小都变了）。测试不该动他的库。改成临时家目录 + 造一个假海。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'thinkauto-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

// 只碰沙箱：这是造的，跟他的海一个字都不重
const sea = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(sea, { recursive: true })
const now = Date.now()
const points = [
  { id: 1, title: '旧唱片机', text: '唱片机是二手的，唱针换过一次，放爵士最好听。', kind: 'fact', imp: 0.6, arousal: 4, born: now - 86400000, strength: 60, layer: 'experience' },
  { id: 2, title: '磨豆机发烫', text: '磨豆机到下午会发烫，得停十分钟再磨，不然粉会结块。', kind: 'fact', imp: 0.6, arousal: 5, born: now - 172800000, strength: 60, layer: 'experience' },
  { id: 3, title: '停电那晚', text: '去年夏天停过一次电，冰箱里的奶全废了，赔了四百多。', kind: 'event', imp: 0.7, arousal: 6, born: now - 259200000, strength: 60, layer: 'experience' },
  { id: 4, title: '店名的来历', text: '店名叫半盏，因为一开始只想做半天生意。', kind: 'fact', imp: 0.6, arousal: 3, born: now - 345600000, strength: 60, layer: 'experience' },
]
writeFileSync(join(sea, 'data.json'), JSON.stringify({ version: 1, points, edges: [] }), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { autoThinkOnce, readThoughts } = await import(LIB + '/thinkauto.js')

const r = await autoThinkOnce(points, { max: 5 })
if (!r.ok) { console.log('没想成：' + r.reason); process.exit(0) }
const t = r.thought
console.log('自己挑的线索：#' + t.seedId + ' ' + t.seedTitle)
console.log('开出 ' + t.opened.length + ' 种：' + t.opened.join('、'))
for (const o of t.ops) {
  console.log('  [' + o.label + '] ' + o.hint)
  for (const it of o.items) console.log('      #' + it.id + ' ' + it.title + '（' + it.why + '）')
}
console.log('存下来的条数：' + readThoughts().length)
console.log('（全程在临时目录里跑的，没碰他的库：' + home + '）')
