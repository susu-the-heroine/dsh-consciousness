/**
 * 改口裁决自测
 * ============
 *   node scripts/test-verdict.mjs
 *
 * 一问现在、一问当时：同一个海，两种问法该给两个版本。
 * 现在那问，旧版不该冒头；当时那问，旧版该排第一。
 * 只在沙箱里造数据，碰不到真库。
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'sea-vd-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(process.cwd(), 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')
const V = await import(LIB + '/verdict.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const now = Date.now()
writeSea('main', {
  version: 3,
  points: [
    { id: 1, title: '那辆车是白的', text: '那时候开的是白色越野车', born: now - 90 * 86400000 },
    { id: 2, title: '那辆车现在改成黑的', text: '后来把车改成黑色，贴了膜', born: now - 3 * 86400000, supersedes: 1 },
  ],
  edges: [],
})

const idsOf = (log) => {
  const out = []
  for (const line of String(log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) out.push(Number(m[1]))
  }
  return out
}

const a = await searchTool.execute({ query: '那辆车 现在', limit: 5, review: false })
const b = await searchTool.execute({ query: '那辆车 原来', limit: 5, review: false })

ok('问现在：新版在', idsOf(a.log).includes(2), idsOf(a.log).join(','))
ok('问现在：旧版不冒头', !idsOf(a.log).includes(1), idsOf(a.log).join(','))
ok('问现在：有提示', String(a.log).includes('按「现在」'), '')
ok('问当时：旧版排第一', idsOf(b.log)[0] === 1, idsOf(b.log).join(','))
ok('问当时：有提示', String(b.log).includes('按「当时」'), '')

// 判定器本身
const mk = () => [
  { p: { id: 1, supersededBy: 2 }, score: 5 },
  { p: { id: 2, supersedes: 1 }, score: 4 },
  { p: { id: 3 }, score: 3 },
]
const rn = V.applyVerdict(mk(), '他现在怎么说')
const rp = V.applyVerdict(mk(), '他原来怎么说')
ok('问现在：旧版被压到新版后面', rn.intent === 'now' && rn.moved === 2, JSON.stringify(rn))
ok('问当时：旧版被抬上来', rp.intent === 'past' && rp.moved === 2, JSON.stringify(rp))
ok('两头都问就不裁决', V.applyVerdict(mk(), '现在和当时都说说').intent === null, '')
ok('没改口的不动', (() => { const x = [{ p: { id: 9 }, score: 5 }]; return V.applyVerdict(x, '现在')?.moved === 0 })())
ok('提示文案对得上', V.verdictNote('now').includes('「现在」') && V.verdictNote('past').includes('「当时」'), '')

console.log(`\n改口裁决自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
