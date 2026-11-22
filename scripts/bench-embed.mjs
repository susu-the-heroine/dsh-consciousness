/**
 * 只量嵌查询那一步
 * =================
 *
 *   node scripts/bench-embed.mjs
 *
 * 三问：同一句两次（看缓存有没有生效）、换一句（看真算要多慢）。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const V = await import(LIB + '/vectors.js')

const q1 = '鲸鱼为什么要在深海里唱歌'
const q2 = '那天晚上在桥底下抽烟到底为了什么'

const t0 = Date.now()
const a = await V.embedQuery(q1)
const t1 = Date.now()
const b = await V.embedQuery(q1)
const t2 = Date.now()
const c = await V.embedQuery(q2)
const t3 = Date.now()

// 2026-11-21：第一次那一百多毫秒含着冷启动，跟后面两句不是一回事。
// 把「第一次含冷启动」写明，免得有人拿它当每次的真实代价。
console.log(`第一次 ${t1 - t0}ms（含冷启动；${a ? a.length : '空'} 维）· 同一句 ${t2 - t1}ms · 换句 ${t3 - t2}ms`)
console.log(`缓存命中：${b === a ? '同一份' : '新算的'} · 第三问 ${c ? c.length : '空'} 维`)
process.exit(0)
