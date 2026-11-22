/**
 * 绑定表清理自测
 * ==============
 *   node scripts/bind-prune-test.mjs
 *
 * 盯的是这条：绑定表里超过三十天没动的窗口要自己清掉，不然每跑一轮测试就多二十几个假窗口，
 * 表越积越长。判据三条：
 *   1) 老的窗口写进去以后再写一次，会被清掉；
 *   2) 新的窗口留着；
 *   3) 清完还能正常查到新窗口对应哪个海。
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'bind-prune-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const m = await import('file:///' + join(HERE, '..', 'lib', 'session.js').replace(/\\/g, '/'))
const F = join(home, '.dsh', 'consciousness-bindings.json')

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }

// 手塞一个五十天前的窗口，再塞一个今天的
const old = Date.now() - 50 * 86400000
writeFileSync(F, JSON.stringify({ v: 1, bySid: { oldSid: { sea: 'main', at: old }, keepSid: { sea: 'main', at: Date.now() } } }), 'utf8')

// 任何一次绑定都会触发清理
m.bindSession('main', 'freshSid')
const after = JSON.parse(readFileSync(F, 'utf8'))
ok('超过三十天的窗口被清掉', !after.bySid.oldSid)
ok('今天的窗口留着', !!after.bySid.keepSid)
ok('新绑的窗口写进去了', !!after.bySid.freshSid)
ok('能查回新窗口的海', m.seaForSession('freshSid') === 'main', String(m.seaForSession('freshSid')))

console.log(`\n绑定表清理：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
