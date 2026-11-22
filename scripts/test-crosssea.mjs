/**
 * 跨海检索自测
 * ============
 *   node scripts/test-crosssea.mjs
 *
 * 两个海里各埋一条：一条讲阑尾炎，一条讲显卡。
 * 问阑尾炎，要能把两个海都摸到、并把命中海标出来。
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-cross-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.C2_EMBED_URL = 'http://127.0.0.1:1'

// 2026-11-21：按当前目录找库，换个目录跑就断。改成按本文件位置算。
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

writeSea('jia', { version: 3, points: [
  { id: 1, title: '阑尾炎八天吊针', text: '2026年11月急性阑尾炎，打了八天吊针，两头头孢。' },
  { id: 2, title: '面条', text: '中午吃的面条，加了两个蛋。' },
], edges: [] })
writeSea('yi', { version: 3, points: [
  { id: 1, title: '显卡驱动回滚', text: '把显卡驱动退回上一版，风扇终于不吵了。' },
  { id: 2, title: '吊针那几天', text: '吊针的时候手背青了一大片，护士说正常。' },
], edges: [] })

const r = await searchTool.execute({ query: '阑尾炎 吊针', seas: ['jia', 'yi'], limit: 6 })
const log = String(r && r.log || '')
ok('跨海有结果', /· #\d+/.test(log), log.slice(0, 80))
ok('标出了来自哪个海', /（(jia|yi)）/.test(log), log.slice(0, 120))
ok('顶上有跨海说明', /^跨 /.test(log), log.split('\n')[0])

const none = await searchTool.execute({ query: '紫金葫芦七娃的遥控器', seas: ['jia', 'yi'], limit: 4 })
ok('两边都没有时说没有', /都没翻到/.test(String(none.log || '')), String(none.log || '').slice(0, 60))

console.log(`\n跨海检索自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
