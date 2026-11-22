process.env.C2_NO_REFUSAL_LOG = '1' // 评测不往真实账本写
/**
 * 名字题拒答自测（端到端）
 * ========================
 *   node scripts/name-gate-test.mjs
 *
 * 2026-11-20 的坑：正文里相邻两个引号会被误配成一对，
 * 里面的逗号短语被认成「名字」，于是「自行车什么牌子」这种没记过的题也答了。
 * 这里走真实检索入口，钉住两件事：假引号要拒答，真牌子要答。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：下面两处按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'namegate-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }
// 2026-11-21：拒答口径多了「有这事、没这细节」这一种说法——只要没把条目端上来，都算拒住了。
const refused = (log) => /没记过|没这个值|没有跟|对不上的事|记糊了/.test(String(log || '')) && !/· #/.test(String(log || ''))

S.writeSea('ng', {
  points: [
    { id: 1, title: '验一条口子', text: '写“自行车停在老槐树下忘了上锁”，立刻问“他的车放哪儿了忘了锁”——这条验过了。', born: Date.now() },
  ],
})

const q = '他那辆自行车是什么牌子的'
const r1 = await T.searchTool.execute({ query: q, sea: 'ng', limit: 3, review: false })
ok('假引号 → 拒答', refused(r1.log), String(r1.log || '').split('\n')[0].slice(0, 40))

S.writeSea('ng2', {
  points: [
    { id: 2, title: '他那辆自行车的牌子', text: '他那辆自行车的牌子是“捷安特ATX”，骑了三年，链条换过两次。', born: Date.now() },
  ],
})
const r2 = await T.searchTool.execute({ query: q, sea: 'ng2', limit: 3, review: false })
ok('真牌子 → 要答', /· #2/.test(String(r2.log || '')), String(r2.log || '').split('\n')[0].slice(0, 40))

// 数值题：问「几块」，正文只有「八天吊针」这种别的单位，不许算答上
S.writeSea('num1', {
  points: [
    { id: 3, title: '他那台电脑', text: '他那台电脑修过，前后折腾了八天吊针那阵子，人还在医院。', born: Date.now() },
  ],
})
const nq = '他修的那台电脑换了几块硬盘'
const r3 = await T.searchTool.execute({ query: nq, sea: 'num1', limit: 3, review: false })
ok('数值题单位对不上 → 拒答', refused(r3.log), String(r3.log || '').split('\n')[0].slice(0, 40))

S.writeSea('num2', {
  points: [
    { id: 4, title: '他那台电脑换了几块硬盘', text: '他那台电脑换了几块硬盘：一共换了 2 块，都是旧的。', born: Date.now() },
  ],
})
const r4 = await T.searchTool.execute({ query: nq, sea: 'num2', limit: 3, review: false })
ok('数值题单位对上 → 要答', /· #4/.test(String(r4.log || '')), String(r4.log || '').split('\n')[0].slice(0, 40))

// 时间题：问「几点」不能被「每天」里的「天」带偏
S.writeSea('tm1', {
  points: [
    { id: 5, title: '他订的牛奶几点送到', text: '他订的牛奶每天七点送到门口，风雨无阻。', born: Date.now() },
  ],
})
const r5 = await T.searchTool.execute({ query: '他订的牛奶每天几点送到', sea: 'tm1', limit: 3, review: false })
ok('问几点（带每天）→ 要答', /· #5/.test(String(r5.log || '')), String(r5.log || '').split('\n')[0].slice(0, 40))

// 灰区（2026-11-21）：这事记着、那个细节记糊了——不许整句说「没记过」。
// 钉住的是话术：既不能端个错条目顶上，也不能把「有这事」说成「没这事」。
S.writeSea('gray1', {
  points: [
    { id: 9, title: '我的黄金战绩——《咬抖音Logo》', text: '那条咬抖音Logo的视频，播放量当时没记，只记得完播率不错。', born: Date.now() },
  ],
})
const r6 = await T.searchTool.execute({ query: '咬抖音那条到底多少播放', sea: 'gray1', limit: 3, review: false })
const l6 = String(r6.log || '')
ok('灰区 → 说「有这事、没这细节」', /记糊了/.test(l6) && !/· #/.test(l6), l6.split('\n')[0].slice(0, 46))

console.log(`\n名字题与数值题：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
