/**
 * 写入去重闸自测
 * ==============
 *   node scripts/dedupe-gate-test.mjs
 *
 * 三件事：
 *   1) 同一段话写两遍，第二遍要拦（并且提示可以 force）；
 *   2) 完全不相干的两条，必须放行；
 *   3) 拦下来的那条不能进库（条数不变）。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'dedupe-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
const add = T.addTool
const sea = 'dedupe-sandbox'

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }
const count = () => ((S.readSea(sea) || {}).points || []).length

const textA = '今晚把写入改成先落临时文件再改名，中途断电也不会留下半截 JSON。'
const textB = '楼下那家牛肉面换老板了，汤变咸，碗也小了。'

const r1 = await add.execute({ title: '写入改法', text: textA, sea })
ok('第一条正常写入', r1 && r1.ok === true, String(r1 && r1.log || '').slice(0, 30))
const n1 = count()

const r2 = await add.execute({ title: '写入改法', text: textA, sea })
const refused = r2 && r2.ok === true && /没写进库/.test(String(r2.log || ''))
ok('同样的内容第二遍被拦', refused)
ok('拦下后条数没变', count() === n1, `${n1} → ${count()}`)
ok('拦下时提示可以 force', /force/.test(String(r2.log || '')))

const r3 = await add.execute({ title: '楼下牛肉面', text: textB, sea })
ok('不相干的一条放行', !/没写进库/.test(String(r3.log || '')), String(r3.log || '').slice(0, 30))

console.log(`\n去重闸：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
