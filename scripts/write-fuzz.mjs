/**
 * 写库压测：连写，每次读回来对一遍
 * ==============================
 *
 * 只往沙箱海写，不碰真库。
 *   node scripts/write-fuzz.mjs sandbox 30
 *
 * 查三件事：写进去返回真、读回来还能解析、条数没少。
 * 2026-11-14 给主写路径补了真刷盘和备份之后写的这个，用来证明没写坏。
 */
import { writeSea } from '../lib/store.js'
import { isMainSea } from './_guard-main.mjs'

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sea = (process.argv[2] || 'sandbox').trim() || 'sandbox'
const times = Math.max(1, Math.min(200, Number(process.argv[3]) || 30))
if (isMainSea(sea)) {
  console.log('拒绝：这个脚本只对沙箱海跑，不许碰 main。')
  process.exit(1)
}

const D = join(homedir(), '.dsh')
const file = join(D, 'consciousness-seas', sea, 'data.json')
if (!existsSync(file)) {
  console.log(`没有这个识海：${sea}`)
  process.exit(1)
}

const base = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const n0 = (base.points || []).length
let bad = 0
for (let i = 0; i < times; i++) {
  const d = JSON.parse(JSON.stringify(base))
  if (d.points && d.points[0]) d.points[0].title = 'fuzz-' + i
  const ok = writeSea(sea, d)
  if (ok !== true) { bad++; continue }
  try {
    const back = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if ((back.points || []).length !== n0) bad++
  } catch { bad++ }
}

// 2026-11-21：跑完不收拾——它每轮把第一条的标题改成 fuzz-序号，
// 最后留在库里的就是「fuzz-9」这种垃圾（实测沙箱海第一条从 fuzz-29 变成 fuzz-9）。
// 这个脚本本来就是拿沙箱海当靶子，靶子打完该恢复原样。
const restored = writeSea(sea, base)
if (restored !== true) bad++

const bakDir = join(D, 'consciousness-backups', sea)
const baks = existsSync(bakDir) ? readdirSync(bakDir).length : 0
console.log(`写了 ${times} 次 · 条数 ${n0} · 失败或读坏 ${bad} · 备份 ${baks} 份`)
process.exit(bad === 0 ? 0 : 1)
