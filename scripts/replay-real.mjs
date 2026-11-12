/**
 * 回放真库
 * ========
 *
 * 拿库里已有的每一条当作输入，用 JS 版重造一遍，跟存着的比。
 *
 * 这不是为了“全对”——库里有些是旧版本写的、有些是手改过的。
 * 目的是看：哪些字段能稳定复现，哪些复现不了，差在哪。
 *
 * 跑法：node scripts/replay-real.mjs [条数]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildPoint } from '../lib/writer-js.js'

const SEA = join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json')
if (!existsSync(SEA)) { console.log('没有库'); process.exit(1) }

const d = JSON.parse(readFileSync(SEA, 'utf8').replace(/^\uFEFF/, ''))
// 只回放当前写入路径产出的（era=dsh）；era=ds 是当初导入的旧格式，字段口径不同
const all = (d.points || []).filter((p) => !p.dead && p.era === 'dsh')
const n = Number(process.argv[2] || 0) || all.length
const sample = all.slice(-n)

// 这些字段天生复现不了：id、坐标、时间、来源编号、手改过的
// 只比“写进去就不再动”的字段。
// 其余都不比：id/坐标/时间本来不同；strength、difficulty、recallCount 会被“被想起”更新；
// entities、herSide、conflictWith、open、said/replied 常常是后来手工补的；
// layer/layerWhy 被分层整理改过；emotion/arousal/polarity 可能被情绪系统回写过。
// 结论：拿历史库当等价基准是不公平的，真正的对照是“同一批输入现场写、立即比”。
const SKIP = new Set(['id', 'x', 'y', 'z', 'born', 'lastSeen', 'src', 'validFrom', 'validUntil',
  'recallCount', 'strength', 'difficulty', 'stale', 'archived', 'archivedAt', 'dead', 'layer', 'layerWhy',
  'emotion', 'arousal', 'polarity', 'imp', 'evidence', 'evidenceRef',
  'entities', 'herSide', 'conflictWith', 'open', 'said', 'replied', 'after', 'target',
  'factKey', 'triggers', 'category', 'confidence', 'cost', 'falsifier', 'origin', 'alias', 'rule'])

const stat = new Map()
let same = 0
const missSample = []

for (const p of sample) {
  const js = buildPoint({
    title: p.titleFull || p.title,
    text: p.text,
    kind: p.kind,
    imp: p.imp,
    arousal: p.arousal,
    polarity: p.polarity,
    alias: p.alias,
  }, [])
  let bad = 0
  for (const k of Object.keys(js)) {
    if (SKIP.has(k)) continue
    const a = JSON.stringify(js[k])
    const b = JSON.stringify(p[k] ?? null)
    if (a !== b) {
      bad++
      stat.set(k, (stat.get(k) || 0) + 1)
      if (missSample.length < 12) missSample.push({ id: p.id, k, js: js[k], real: p[k] })
    }
  }
  if (!bad) same++
}

console.log(`回放 ${sample.length} 条，全字段一致 ${same} 条（${Math.round(same / sample.length * 100)}%）`)
if (stat.size) {
  console.log('对不上的字段（次数）：')
  for (const [k, v] of [...stat.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ${v}`)
  console.log('样例：')
  for (const m of missSample.slice(0, 6)) {
    console.log(`  #${m.id} ${m.k}: JS=${JSON.stringify(m.js)} 真库=${JSON.stringify(m.real)}`)
  }
} else {
  console.log('没有字段对不上。')
}
