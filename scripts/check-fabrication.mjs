/**
 * 编造检测：拿一段回话，去对照它引用的那几条记忆原文。
 * ==========================================
 * 为什么会编：检索这层给的是原文，不会编；把原文改写成回话那一步才会。
 * 所以只查一件事——回话里出现的数字、英文词、引号里的专名，原文里有没有。
 *
 *   node scripts/check-fabrication.mjs <sea> <id,id,...> "回话正文"
 *   node scripts/check-fabrication.mjs <sea> <id,id,...> --stdin < reply.txt
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] || 'main'
const idArg = process.argv[3] || ''
const ids = idArg.split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x))
let reply = process.argv[4] || ''
if (reply === '--stdin') reply = readFileSync(0, 'utf8')

const dataPath = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
const src = (data.points || []).filter((p) => ids.includes(Number(p.id)))
if (!src.length) { console.log('没找到这些 id：' + idArg); process.exit(2) }
const hay = src.map((p) => String(p.title || '') + ' ' + String(p.text || '') + ' ' + String(p.alias || '')).join(' ')
const norm = (s) => s.replace(/[，。、；：！？「」『』""''（）()《》\s]/g, '')

const pick = (re) => [...reply.matchAll(re)].map((m) => m[0])
// 2026-11-21：只查阿拉伯数字会漏——编造常常写成「十一月七号」。
// 带单位的汉字数字也一起查（年月日号点岁块钱个条天周次）。
const nums = [...new Set([...pick(/\d+(?:\.\d+)?/g), ...pick(/[零一二三四五六七八九十百千万亿两]{1,4}(?:年|月|日|号|点|岁|块|钱|个|条|天|周|次)/g)])]
const words = [...new Set(pick(/[A-Za-z][A-Za-z0-9_]{2,}/g))]
const quoted = [...new Set(pick(/[「『“"]([^」』”"]{2,12})[」』”"]/g).map((s) => s.slice(1, -1)))]

const bad = []
for (const x of nums) if (!hay.includes(x)) bad.push('数字 ' + x)
for (const x of words) if (!hay.toLowerCase().includes(x.toLowerCase())) bad.push('英文 ' + x)
for (const x of quoted) if (!norm(hay).includes(norm(x))) bad.push('专名 ' + x)

console.log('对照 ' + src.length + ' 条原文（#' + ids.join(' #') + '）')
console.log('回话里：数字 ' + nums.length + ' · 英文 ' + words.length + ' · 引号专名 ' + quoted.length)
if (!bad.length) console.log('结论：没有编——每个数字、英文词、专名都在原文里。')
else { console.log('结论：有 ' + bad.length + ' 处原文里找不到：'); for (const b of bad) console.log('  · ' + b) }