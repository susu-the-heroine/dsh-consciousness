/**
 * 拒答四道闸：各管一段、互不顶替、一个总开关管全部
 * ================================================
 *   node scripts/refusal-gates-test.mjs
 *
 * 验三件：
 *   1. 四种“库里没有”各有闸拦：问具体值、问没记过的主体、整句编的、一个词都对不上
 *   2. 真记得的四条，闸全开着也不许拒
 *   3. 总开关关掉：四条假的全部放行（不拒），保持旧行为
 *
 * 全程临时库，不碰真库。
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL = homedir()
const tmp = mkdtempSync(join(tmpdir(), 'gates-'))
mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })
cpSync(join(REAL, '.dsh', 'consciousness-seas', 'main'), join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
process.env.USERPROFILE = tmp
process.env.HOME = tmp

const { searchTool } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
const said = async (q) => String((await searchTool.execute({ sea: 'main', query: q, limit: 5, review: false })).log || '')
const refused = (t) => /没记过/.test(t)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

// 1) 四道闸各拦一类
const fakes = [
  ['问具体值（号码）', '他外婆家的门牌号是多少'],
  ['问没记过的主体', '他养的那只蜥蜴叫什么名字'],
  ['整句编的', '他去年去冰岛住的哪家酒店'],
  ['一个词都对不上', '公司年会抽奖程序谁写的'],
]
delete process.env.C2_GHOST_REFUSE
for (const [name, q] of fakes) {
  const t = await said(q)
  ok('拦住：' + name, refused(t), String(t).split('\n')[0].slice(0, 30))
}

// 2) 真记得的不许拒
const reals = ['那次即梦打赌', '我本名是什么', '济南经十路', '他阑尾炎住了几天院']
for (const q of reals) {
  const t = await said(q)
  ok('不误拒：' + q, !refused(t), String(t).split('\n')[0].slice(0, 30))
}

// 3) 总开关关掉，假的一条都不许拒
process.env.C2_GHOST_REFUSE = '0'
let offRefused = 0
for (const [, q] of fakes) if (refused(await said(q))) offRefused++
ok('总开关关掉：四条全放行', offRefused === 0, '仍拒了 ' + offRefused)
delete process.env.C2_GHOST_REFUSE

console.log(`\n拒答四道闸：通过 ${pass} · 失败 ${fail}`)
try { rmSync(tmp, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
