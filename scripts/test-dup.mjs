/**
 * 写入查重自测
 * ============
 *   node scripts/test-dup.mjs
 *
 * 两条几乎一样的：后写的那条挂 dupOf；不相干的不许挂。
 * 顺带量一下两千条写一次要多久（不能卡）。
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-dup-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea, readSea } = await import(LIB + '/store.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const base = '急性阑尾炎打了八天吊针，两头都是头孢，第九天肚子才不疼。'
writeSea('main', {
  version: 3,
  points: [
    { id: 1, title: '阑尾炎', text: base },
    { id: 2, title: '阑尾炎（重记）', text: base },
    { id: 3, title: '显卡驱动', text: '今天把显卡驱动回滚到上一版，风扇不吵了。' },
  ],
  edges: [],
})

const d = readSea('main')
const p1 = d.points.find((p) => p.id === 1)
const p2 = d.points.find((p) => p.id === 2)
const p3 = d.points.find((p) => p.id === 3)

ok('两条一样的，后一条挂了标记', !!(p2.dupOf && p2.dupOf.id === 1), JSON.stringify(p2.dupOf || null))
ok('先写的那条不许被挂', !p1.dupOf, JSON.stringify(p1.dupOf || null))
ok('不相干的没被挂', !p3.dupOf, JSON.stringify(p3.dupOf || null))
ok('标记带相似度', !!(p2.dupOf && p2.dupOf.score >= 0.8), JSON.stringify(p2.dupOf || null))

// 两千条写一次：不许卡成几秒
const big = []
for (let i = 1; i <= 2000; i++) big.push({ id: 1000 + i, title: '第' + i + '条', text: '第' + i + '条内容，聊的是' + (i % 97) + '号话题，夹一点细节。' })
const t0 = Date.now()
writeSea('bulk', { version: 3, points: big, edges: [] })
const ms = Date.now() - t0
ok('两千条一次写入不卡（<2s）', ms < 2000, ms + 'ms')

console.log(`\n查重自测：通过 ${pass} · 失败 ${fail} · 两千条写入 ${ms}ms`)
process.exit(fail ? 1 : 0)
