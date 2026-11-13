/**
 * 端到端：在一个"别人家"的库上跑检索
 * ==================================
 *
 * 为什么要有：前面的规则都在同一个人的库上调的，容易只对他的问法有效。
 * 这里现造一个陌生人的库——一个开咖啡店的——15 条记忆，跟本机一个字都不重。
 * 然后问 12 句：有 8 句该答上，4 句该说"凑出来的"。
 *
 * 跑法：node scripts/test-shape-other-sea.mjs
 * 跑完自己清掉那个临时识海，不留垃圾。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const SEA = '__shape_test_other_sea__'
const DIR = join(homedir(), '.dsh', 'consciousness-seas', SEA)
const now = Date.now()

const P = (id, title, text) => ({
  id, title, text, alias: '', kind: 'fact', imp: 0.6, arousal: 0, born: now - id * 86400000,
  strength: 100, layer: 'core', category: [], entities: [], open: false, rule: false,
})

const points = [
  P(1, '店里的咖啡豆', '豆子从城南那家烘豆厂进，中深烘，一周送一次。'),
  P(2, '拿铁的价格', '拿铁小杯十八块，大杯二十一块，燕麦奶加三块。'),
  P(3, '开店的日子', '店是二零二一年四月八号开的，第一周只卖了四十杯。'),
  P(4, '磨豆机的脾气', '磨豆机到下午会发烫，得停十分钟再磨，不然粉会结块。'),
  P(5, '常客老周', '老周每天下午三点来，喝美式，不加糖，坐靠窗那张桌。'),
  P(6, '第一次拉花', '第一次拉出天鹅是练了三个月之后，那天高兴到关店早。'),
  P(7, '房租', '房租每个月六千二，季度付，房东姓陈。'),
  P(8, '学徒小满', '小满去年九月来的，学得快，就是奶泡总打太厚。'),
  P(9, '下雨天的生意', '下雨天客人少一半，但外带的单子会多起来。'),
  P(10, '那台旧唱片机', '唱片机是二手的，唱针换过一次，放爵士最好听。'),
  P(11, '店名的来历', '店名叫“半盏”，因为一开始只想做半天生意。'),
  P(12, '招牌的木头', '招牌是找木工做的，樟木，刻字花了三天。'),
  P(13, '最忙的一天', '最忙是去年圣诞节，一天出了两百三十杯。'),
  P(14, '停电那次', '去年夏天停过一次电，冰箱里的奶全废了，赔了四百多。'),
  P(15, '账本的习惯', '每天关店记一遍账，用的是那种带格子的本子。'),
]

// [问句, 期望] —— hit = 该答上；miss = 该说"凑出来的"
const cases = [
  ['拿铁多少钱', 'hit'],
  ['店是几号开的', 'hit'],
  ['房租多少', 'hit'],
  ['最忙的一天卖了多少杯', 'hit'],
  ['老周喝什么', 'hit'],
  ['店名叫什么', 'hit'],
  ['磨豆机下午发烫怎么办', 'hit'],
  ['房东姓什么', 'hit'],
  ['店里的wifi密码多少', 'miss'],
  ['老板手机号多少', 'miss'],
  ['他一共雇了几个人', 'miss'],
  ['去年赚了多少钱', 'miss'],
]

const clean = () => { try { if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true }) } catch {} }

let bad = 0
try {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(join(DIR, 'data.json'), JSON.stringify({ version: 1, points, edges: [] }), 'utf8')
  writeFileSync(join(DIR, 'meta.json'), JSON.stringify({ count: points.length, mtime: '2026-11-13 21:00' }, null, 2), 'utf8')

  // 路径按脚本自己所在的位置算，别按当前目录——在哪儿跑都得能找到 lib
  const here = dirname(fileURLToPath(import.meta.url))
  // 冷库是假的：真实使用里，每条记忆写入时就带去向量。
  // 这里直接把文件造出来，向量是空的，前几问会全被判成"凑出来的"。
  // 所以先按正常路径把向量补齐，再开始问。
  const V = await import('file:///' + join(here, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
  let warmed = 0
  for (let i = 0; i < 20; i++) {
    const n = await V.syncVectors(SEA, { points, edges: [] }, 50)
    warmed += n
    if (!n) break
  }
  console.log('（先补了 ' + warmed + ' 条向量）')

  const T = await import('file:///' + join(here, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())
  for (const [q, want] of cases) {
    let log = ''
    try { const r = await T.searchTool.execute({ query: q, limit: 5, sea: SEA }); log = String(r.log || '') } catch {}
    const got = /凑出来的/.test(log) ? 'miss' : 'hit'
    const ok = got === want
    if (!ok) bad++
    console.log((ok ? '✓' : '✗') + ' 「' + q + '」 期望 ' + want + ' 实际 ' + got)
  }
  console.log('\n错的 ' + bad + ' / ' + cases.length)
} finally {
  clean()
}

if (bad > 0) process.exit(1)
