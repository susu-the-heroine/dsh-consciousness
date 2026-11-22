/**
 * 海名大小写撞车
 * ==============
 *   node scripts/sea-case-test.mjs
 *
 * 2026-11-20 的坑：Windows 里 Main 和 main 是同一个目录，
 * 先写 Main 再写 main，第二条把第一条盖掉，数据静默丢。
 * 这条守着：只差大小写的第二个海必须被拒；不同名照写。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库按当前目录找——从别的目录跑就报「找不到 file:///C:/lib/store.js」，
// 一条测试白跑还看不出是路径问题。改成按本文件位置找。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-case-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }

const one = (id, title) => ({ points: [{ id, title, text: '正文', born: Date.now() }] })

S.writeSea('CaseSea', one(1, '大写那份'))
ok('第一个海写进去', (S.readSea('CaseSea').points || []).length === 1)

let threw = ''
try { S.writeSea('casesea', one(2, '小写那份')) } catch (e) { threw = String(e && e.message) }
ok('只差大小写的第二个被拒', /只差大小写/.test(threw), threw.slice(0, 24))
ok('大写那份没被盖掉', (S.readSea('CaseSea').points || [])[0].title === '大写那份')

S.writeSea('casesea2', one(3, '另一个海'))
ok('不同名字照写', (S.readSea('casesea2').points || []).length === 1)

console.log(`\n海名撞车：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
