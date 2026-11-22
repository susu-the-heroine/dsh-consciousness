/**
 * 隔几天再问，还认不认得
 * ======================
 *
 *   node scripts/test-cross-session.mjs
 *
 * 人的记性怕两件事：时间久了、后来又记了别的把旧的挤下去。
 * 这里就压这两件：先问一遍，再往海里塞三十条新的（同一个人的别的事），再问一遍。
 *
 * 闸门：同一件事，第二次问还得是头名；掉了就算挂。
 */
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'sea-cross-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea, readSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')

const suite = JSON.parse(readFileSync(join(HERE, 'data', 'bench-synth.json'), 'utf8'))
// 2026-11-21：写库回执不看，写不进去也照跑——两轮都查的是旧库，照样报一百，等于假过。
if (writeSea('main', { version: 3, points: suite.points, edges: [] }) === false) {
  console.log('假库没写进去，这一轮不出分')
  process.exit(2)
}

const top = (log) => {
  for (const line of String(log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) return Number(m[1])
  }
  return 0
}

const who = ['小满', '老周', '阿亮', '师傅', '隔壁老王', '表姐']
const things = ['那台旧相机', '那把吉他', '那只橘猫', '那盆绿萝', '那个保温杯', '那盏台灯']
const evs = ['修好了', '送人了', '被偷了', '一直没动']

// 挑十道好问的题
const cases = suite.cases.filter((c) => c.kind === 'paraphrase' || c.kind === 'title').slice(0, 10)

const before = []
for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: 3, review: false })
  before.push({ q: c.q, expect: Number(c.expect), top: top(r.log) })
}

// 隔了几天：又记了三十条，全是同一批人的别的事
const data = readSea('main')
const now = Date.now()
let id = Math.max(...data.points.map((p) => Number(p.id) || 0))
for (let i = 0; i < 30; i++) {
  id++
  const w = who[i % who.length]
  const t = things[i % things.length]
  const e = evs[i % evs.length]
  data.points.push({
    id,
    title: w + t + e,
    text: w + t + e + '。后来又提过一次。',
    born: now - i * 60000,
    imp: 0.5,
    kind: 'event',
    obj: t,
    owner: w,
  })
}
if (writeSea('main', data) === false) {
  console.log('塞三十条那步没写进去，后半程别信')
  process.exit(2)
}

let same = 0
const bad = []
for (const b of before) {
  const r = await searchTool.execute({ query: b.q, limit: 3, review: false })
  const t = top(r.log)
  if (t === b.expect) same++
  else bad.push(`「${b.q}」原来 #${b.expect}，现在 #${t || '没回话'}`)
}

const n = before.length || 1
const rate = same / n
console.log(`题 ${n} 道 · 中间又记了 30 条 · 仍指回原条 ${same} 道 = ${(rate * 100).toFixed(0)}%（闸门 100%）`)
for (const x of bad.slice(0, 8)) console.log('  ' + x)
console.log(rate === 1 ? '过：隔了几天、又记了别的，旧的还认得出来' : '挂：新记忆把旧的挤掉了')
process.exit(rate === 1 ? 0 : 1)
