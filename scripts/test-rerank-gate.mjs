/**
 * 第二道闸：重排概率低就说没记住
 * ==============================
 *   node scripts/test-rerank-gate.mjs
 *
 * 问一件库里根本没有的事：不许硬凑，要明说没记住。
 * 问一件库里有的：照常给。
 * 全程临时目录。
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-gate-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.C2_EMBED_URL = 'http://127.0.0.1:1'

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const points = []
for (let i = 1; i <= 30; i++) {
  points.push({ id: i, title: '杂事 ' + i, text: '今天吃了面条，聊了显卡驱动，顺手把桌面收拾了一下，第' + i + '回。', born: Date.now() - i * 60000 })
}
points.push({ id: 31, title: '阑尾炎打了八天吊针', text: '2026年11月，急性阑尾炎，打了八天吊针，两头都是头孢。', born: Date.now() })
writeSea('main', { version: 3, points, edges: [] })

const miss = await searchTool.execute({ query: '紫金葫芦七娃的彩电遥控器在哪', limit: 5 })
const ml = String(miss.log || '')
ok('库里没有的事：明说没记住', /没记住|没记过|没有跟/.test(ml), ml.slice(0, 60))
ok('没有硬凑出来的条目', !/^· #/m.test(ml), ml.slice(0, 80))

const hit = await searchTool.execute({ query: '阑尾炎 吊针', limit: 5 })
ok('库里有的：照常给', /#31/.test(String(hit.log || '')), String(hit.log || '').slice(0, 60))

console.log(`\n第二道闸自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
