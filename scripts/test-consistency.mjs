/**
 * 一致性反证
 * ==========
 *
 *   node scripts/test-consistency.mjs
 *
 * 一条事换三种问法问三遍，答案应改是同一条。
 * 三种问法：原话、换个说法（主人＋东西）、只给事件。
 * 只要有一次头名不同，就算「打脸」一次。
 *
 * 闸门：打脸率 ≤ 0.10。这条比单次答对狠——单次对了三次不一样，说明是碰上的。
 * 只碰假库，不碰他的真库。
 */
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'sea-consist-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')

const suite = JSON.parse(readFileSync(join(HERE, 'data', 'bench-synth.json'), 'utf8'))
writeSea('main', { version: 3, points: suite.points, edges: [] })

const top = (log) => {
  for (const line of String(log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) return Number(m[1])
  }
  return 0
}

const EVENT = /(被偷了|修好了|送人了|摔坏了|忘在车上|一直没动|换了新的|借出去了)/

// 先剔掉本身就有歧义的题：同一个人同一件事有好几件时，「那个被偷了的东西」没唯一答案，
// 那种题考的是运气，不是一致性。
const keyOf = (p, ev) => String(p.owner || '') + '|' + ev
const count = new Map()
for (const p of suite.points) {
  const ev = (String(p.title || '').match(EVENT) || [])[1]
  if (!ev) continue
  const k = keyOf(p, ev)
  count.set(k, (count.get(k) || 0) + 1)
}

const items = []
for (const p of suite.points) {
  if (items.length >= 25) break
  const ev = (String(p.title || '').match(EVENT) || [])[1]
  if (!ev || !p.owner || !p.obj) continue
  if ((count.get(keyOf(p, ev)) || 0) > 1) continue
  items.push({
    id: Number(p.id),
    ask: [
      String(p.title).replace(/\s+/g, ''),
      p.owner + p.obj + '后来咋样了',
      p.owner + '那个' + ev + '的东西后来咋样了',
    ],
  })
}

let face = 0
// 2026-11-21：三种问法都没捞到东西时，三个「头名」都是零，等于是被判成「一致」——
// 空库跑一遍能拿零打脸、全绿通过。没捞到要单算，不许当一致。
let miss = 0
const bad = []
for (const it of items) {
  const got = []
  for (const q of it.ask) {
    const r = await searchTool.execute({ query: q, limit: 3, review: false })
    got.push(top(r.log))
  }
  if (got.every((g) => g === 0)) { miss++; continue }
  const same = got.every((g) => g === got[0])
  if (!same) {
    face++
    bad.push(`#${it.id} → ${got.join(' / ')}（${it.ask.map((x, i) => x + '⇒' + got[i]).join('；')}）`)
  }
}

const n = items.length || 1
const rate = face / n
const pass = rate <= 0.10 && miss === 0

console.log(`题 ${n} 条 · 三种问法 · 打脸 ${face} 条 = ${(rate * 100).toFixed(1)}%（闸门 ≤10%）`
  + (miss ? ` · 三问都没捞到 ${miss} 条（库没写进去？）` : ''))
for (const b of bad.slice(0, 8)) console.log('  ' + b)
console.log(pass ? '过：换三种问法，指的还是同一条' : '挂：问法一换，答案就换人')
process.exit(pass ? 0 : 1)
