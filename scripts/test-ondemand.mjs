/**
 * 按需读向量自测
 * ==============
 *   node scripts/test-ondemand.mjs
 *
 * 四千条：第一问把索引建出来，第二问走按需读，只读候选那几百条。
 * 答案还得对。
 */
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-ond-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const VX = await import(LIB + '/vecstore.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')
const tools = await import(LIB + '/tools.js')
const searchTool = tools.searchTool

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const N = 4000
const points = []
for (let i = 1; i <= N; i++) {
  points.push({ id: i, title: '记忆 ' + i, text: '第' + i + '条：' + (i === 77 ? '阑尾炎打了八天吊针，两头头孢。' : '内容 ' + i + '，聊的是日常。'), born: Date.now() - i * 1000 })
}
writeSea('main', { version: 3, points, edges: [] })

mkdirSync(join(SEAS_DIR, 'main'), { recursive: true })
const ent = []
for (const p of points) {
  const v = new Float32Array(512)
  for (let k = 0; k < 512; k++) v[k] = Math.sin(p.id * 0.011 + k * 0.13)
  ent.push({ id: p.id, v, h: VX.fpOf(p) })
}
VX.putMany('main', ent)

const r1 = await searchTool.execute({ query: '阑尾炎 吊针', limit: 3 })
ok('第一问能翻到', /#77/.test(String(r1.log || '')), String(r1.log || '').slice(0, 60))
ok('索引落盘了', existsSync(join(SEAS_DIR, 'main', 'ann.json')))

console.log('  · 第一问之后账本', Object.keys(VX.readIdx('main').ids).length)
process.env.C2_ONDEMAND = '1'
const r2 = await searchTool.execute({ query: '阑尾炎 吊针', limit: 3 })
ok('按需读下还能翻到', /#77/.test(String(r2.log || '')), String(r2.log || '').slice(0, 60))
const st = tools.LAST_LOAD || {}
ok('走的是按需读', st.mode === 'ondemand', JSON.stringify(st))
ok('只读了候选那几百条（远小于四千）', Number(st.loaded) > 0 && Number(st.loaded) < 2000, JSON.stringify(st))

console.log(`\n按需读自测：通过 ${pass} · 失败 ${fail} · ${JSON.stringify(st)}`)
process.exit(fail ? 1 : 0)
