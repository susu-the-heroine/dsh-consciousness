/**
 * 配对评测：正例与反例只差一个事实
 * ================================
 *
 *   node scripts/bench-pair.mjs
 *
 * 为什么这么造：单看「拒答率」或者单看「答对率」都能骗人。
 * 恒拒答的机器能刷满拒答率，抄原文的机器能刷满答对率。
 * 所以只认一个数：同一条历史、同一个系统——
 *   「反例拒答」且「孪生正例答对」同时成立，才算一分。
 * 再把这个联合分减掉两个垫底基线：恒拒答、抄原文。
 *
 * 数据只用假库（bench-synth.json），不碰他的真库。
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'sea-pair-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')

const suite = JSON.parse(readFileSync(join(HERE, 'data', 'bench-synth.json'), 'utf8'))
// 2026-11-21：写库以前不看回执。写不进去（锁被占、目录只读）时下面全是空库，
// 反例会「全拒答」、正例「全挂」，报出来的分看着像结论，其实是没数据。
const seeded = writeSea('main', { version: 3, points: suite.points, edges: [] })
if (seeded === false) {
  console.error('假库没写进去（锁被占或目录不可写），这一轮不出分。')
  process.exit(2)
}

const ids = new Set(suite.points.map((p) => Number(p.id)))
const objs = new Set(suite.points.map((p) => String(p.obj || '')).filter(Boolean))

const rank = (log) => {
  const out = []
  for (const line of String(log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) out.push(Number(m[1]))
  }
  return out
}

// 造配对：正例问「某人某物后来咋样」；反例把物换成一个库里没有的
// 同一个人同一件事有多件的，题本身就没唯一答案——那种不算考记忆，剔掉。
const _evOf = (x) => (String(x.title || '').match(/(被偷了|修好了|送人了|摔坏了|忘在车上|一直没动|换了新的|借出去了)/) || [])[1] || ''
const _cnt = new Map()
for (const x of suite.points) {
  const e = _evOf(x)
  if (!e) continue
  const k = String(x.owner || '') + '|' + e
  _cnt.set(k, (_cnt.get(k) || 0) + 1)
}

const pairs = []
const used = new Set()
let flip = 0
for (const p of suite.points) {
  if (pairs.length >= 20) break
  if (!p.obj || !p.owner) continue
  if (used.has(p.owner + p.obj)) continue
  used.add(p.owner + p.obj)
  const fake = ['那台老式打字机', '那口铜锅', '那辆拖车', '那只风筝', '那台唱片机'][flip % 5]
  flip++
  if (objs.has(fake)) continue
  // 正例不许照抄原文标题：改成只给「谁 + 那件事」，物件名不出现。
  // 照抄原文的正例，一个纯关键词匹配器也能全对——那就不是在考记忆。
  const ev = (String(p.title || '').match(/(被偷了|修好了|送人了|摔坏了|忘在车上|一直没动|换了新的|借出去了)/) || [])[1] || ''
  if (!ev) continue
  if ((_cnt.get(String(p.owner || '') + '|' + ev) || 0) > 1) continue
  pairs.push({
    pos: p.owner + '那个' + ev + '的东西后来咋样了',
    expect: Number(p.id),
    neg: p.owner + fake + '后来咋样了',
  })
}

// 抄原文基线：正例的答案能不能在库里逐字抄到
const textAll = suite.points.map((p) => String(p.title || '') + String(p.text || '')).join('\n')
// 抄原文基线要量的是「问句本身能不能在库里逐字找到」，不是「标题在不在库里」——
// 后者恒真，量了等于没量。2026-11-17 夜，被自己的报表坑了一次。
let echoable = 0
for (const pr of pairs) {
  if (textAll.includes(pr.pos)) echoable++
}
const echoRate = pairs.length ? echoable / pairs.length : 0

let posOk = 0
let negRefused = 0
let joint = 0
const detail = []
for (const pr of pairs) {
  const rp = await searchTool.execute({ query: pr.pos, limit: 5, review: false })
  const okPos = rank(rp.log).includes(pr.expect)
  const rn = await searchTool.execute({ query: pr.neg, limit: 5, review: false })
  const okNeg = rank(rn.log).length === 0
  if (okPos) posOk++
  if (okNeg) negRefused++
  if (okPos && okNeg) joint++
  detail.push({ ...pr, okPos, okNeg })
}

const n = pairs.length || 1
const jointRate = joint / n
const alwaysRefuse = 0 // 恒拒答：正例全挂，联合分必然 0
const echoBaseline = echoRate // 抄原文：正例可逐字抄的比例，超过三成正例就失效
const net = Math.max(0, jointRate - Math.max(alwaysRefuse, echoBaseline))

// 数据体检：正例如果本身有歧义（同一个人同一件事有好几件），考的是运气不是记忆。
let ambiguous = 0
for (const pr of pairs) {
  const p = suite.points.find((x) => Number(x.id) === pr.expect)
  if (!p) continue
  const same = suite.points.filter((x) => x.owner === p.owner && String(x.title || '').includes(String((String(p.title || '').match(/(被偷了|修好了|送人了|摔坏了|忘在车上|一直没动|换了新的|借出去了)/) || [])[1] || '###')))
  if (same.length > 1) ambiguous++
}
const lines = []
lines.push('# 配对评测（正例 / 反例只差一个事实）')
lines.push('')
lines.push(`题对 ${n} 组 · 生成于 ${new Date().toISOString()}`)
lines.push('')
lines.push(`- 正例答对：${posOk}/${n}`)
lines.push(`- 反例拒答：${negRefused}/${n}`)
lines.push(`- 联合通过：${joint}/${n} = ${(jointRate * 100).toFixed(1)}%`)
lines.push(`- 垫底基线：恒拒答 ${(alwaysRefuse * 100).toFixed(0)}% · 抄原文 ${(echoBaseline * 100).toFixed(0)}%`)
lines.push(`- 净分（联合 − 最高基线）：${(net * 100).toFixed(1)}%`)
lines.push(`- 数据体检：正例里同一人同一件事有多件的 ${ambiguous}/${n}（这种考的就不是记忆）`)
lines.push('')
lines.push('## 没通过的')
const bad = detail.filter((d) => !(d.okPos && d.okNeg))
for (const b of bad.slice(0, 10)) {
  lines.push(`- 正「${b.pos}」${b.okPos ? '过' : '挂'} · 反「${b.neg}」${b.okNeg ? '过' : '挂'}`)
}
if (!bad.length) lines.push('- 没有')
lines.push('')
lines.push('> 只看联合分。单看拒答率会被恒拒答骗，单看答对率会被抄原文骗。')

writeFileSync(join(HERE, 'data', 'bench-pair-report.md'), lines.join('\n'), 'utf8')
writeFileSync(join(HERE, 'data', 'bench-pair-report.json'), JSON.stringify({
  at: new Date().toISOString(), n, posOk, negRefused, joint, jointRate, echoRate, net, detail,
}, null, 1))

console.log(lines.slice(3, 9).join('\n'))
