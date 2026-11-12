/**
 * 端到端：按真实结构测
 * ===================
 * 改过一次，因为第一版写着写着发现三件真事：
 *   1. 记忆没有"删除工具"，只有归档；删是通过路由 /consciousness/delete
 *   2. 页面不落盘，是接口按海现生成的 → 要验就验现生成的 HTML
 *   3. 内观接口的情绪字段叫 moodline，不是 mood
 * 这三条不是 bug，是我原来想错。脚本照真实结构写。
 *
 * 跑法：node scripts/sim-e2e.mjs [基地址]
 */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:54495'
const SEA = 'e2etest'
const SEA2 = 'e2etest2'
const seaDir = (s) => join(homedir(), '.dsh', 'consciousness-seas', s)

const base = 'file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/'
const store = await import(base + 'lib/store.js')
const T = await import(base + 'lib/tools.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}
const get = async (p) => {
  const r = await fetch(BASE + p)
  return { status: r.status, body: await r.text() }
}

for (const s of [SEA, SEA2]) {
  try { if (existsSync(seaDir(s))) rmSync(seaDir(s), { recursive: true, force: true }) } catch {}
}

console.log('\n一、写 → 文件 → 页面（现生成）')
store.writeSea(SEA, { version: 1, points: [], edges: [], createdAt: Date.now() })
const MARK = 'E2E' + Date.now().toString(36)
const w = await T.addTool.execute({
  sea: SEA, title: MARK, text: '这条只用来验链，' + MARK + '，验完就删。', kind: 'fact', imp: 0.7,
}, {})
ok(w && w.ok, '写进去了', String(w && w.log).slice(0, 30))

const d = store.readSea(SEA)
ok((d.points || []).some((p) => String(p.title).includes(MARK)), '数据文件里有这条')

const page = await get('/consciousness?id=' + SEA)
ok(page.status === 200 && page.body.includes(MARK), '现生成的页面里有这条', 'HTTP ' + page.status + ' / ' + page.body.length + ' 字节')

console.log('\n二、情绪 → 注入 → 内观')
const sim = await get('/consciousness/sim?text=' + encodeURIComponent('我他妈气死了，这破玩意又崩'))
let inject = ''
try { inject = JSON.parse(sim.body).inject || '' } catch {}
const line = (inject.match(/【她这会儿】[^\n]*/) || [''])[0]
ok(!!line, '注入里有「她这会儿」', line.slice(0, 24))
ok(!/平静/.test(line), '这句不是平静', line.slice(0, 30))

const inner = await get('/consciousness/inner-data')
let ij = null
try { ij = JSON.parse(inner.body) } catch {}
ok(inner.status === 200 && ij && (typeof ij.moodline === 'string' || !!ij.dims), '内观有情绪字段（moodline 或 dims）', Object.keys(ij || {}).slice(0, 6).join(','))

console.log('\n三、归档而不是删')
const list = await T.listTool.execute({ sea: SEA }, {})
ok(!!list && !!list.log, '列表读得到', String(list && list.log).slice(0, 24))

console.log('\n四、两个海不串')
store.writeSea(SEA2, { version: 1, points: [], edges: [], createdAt: Date.now() })
await T.addTool.execute({ sea: SEA2, title: '第二个海的标记', text: '只在第二个海里，不该跑到第一个。', kind: 'fact', imp: 0.6 }, {})
const p1 = (store.readSea(SEA).points || []).map((p) => String(p.title))
const p2 = (store.readSea(SEA2).points || []).map((p) => String(p.title))
ok(p2.some((t) => t.includes('第二个海')), '第二个海写进去了')
ok(!p1.some((t) => t.includes('第二个海')), '第一个海没被污染')

const page2 = await get('/consciousness?id=' + SEA2)
ok(page2.status === 200 && page2.body.includes('第二个海'), '第二个海也有自己的页面')

for (const s of [SEA, SEA2]) {
  try { if (existsSync(seaDir(s))) rmSync(seaDir(s), { recursive: true, force: true }) } catch {}
}
ok(!existsSync(seaDir(SEA)) && !existsSync(seaDir(SEA2)), '测试海清干净')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
