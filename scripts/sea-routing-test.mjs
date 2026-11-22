/**
 * 多海路由自测
 * ============
 *   node scripts/sea-routing-test.mjs
 *
 * 三件事，都是「外人装两个海」时会踩的：
 *   1) 显式指定 sea，检索必须只出这个海的条目；
 *   2) 不指定 sea，默认走主海（写死在行为里的约定，不是 bug）；
 *   3) 绑定表能把会话反查回海。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-route-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
const M = await import('file:///' + join(HERE, '..', 'lib', 'session.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }
const firstId = (log) => {
  const line = String(log || '').split('\n').find((l) => l.startsWith('· #'))
  const m = line && /· #(\d+)/.exec(line)
  return m ? Number(m[1]) : null
}

S.writeSea('main', { points: [{ id: 1, title: '主海里的事', text: '主海的正文', born: Date.now() }] })
S.writeSea('haitwo', { points: [{ id: 2, title: '第二海里的事', text: '第二海的正文', born: Date.now() }] })

const r1 = await T.searchTool.execute({ query: '海里的事', sea: 'haitwo', limit: 3, review: false })
ok('指定 haitwo 时只出第二海那条', firstId(r1.log) === 2, String(firstId(r1.log)))

const r2 = await T.searchTool.execute({ query: '海里的事', limit: 3, review: false })
ok('不指定海时走主海（约定行为）', firstId(r2.log) === 1, String(firstId(r2.log)))

M.bindSession('haitwo', 'sidA')
ok('绑定表能反查回 haitwo', M.seaForSession('sidA') === 'haitwo', String(M.seaForSession('sidA')))

console.log(`\n多海路由：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
