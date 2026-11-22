/**
 * 把 SQLite 镜像按 JSON 重建一遍
 * ==============================
 *
 *   node scripts/mirror-sync.mjs main
 *
 * 什么时候用：sqlite-parity 报"可漂移"不是 0 的时候。
 * 漂移一般是后台心跳改了强度但没走写库（只写 JSON），镜像就落后一点。
 * 这个脚本只重写镜像，不动 data.json——JSON 永远是准的那一份。
 *
 * 2026-11-14 夜：回归本来红了一次，就是这个原因（13 处强度差 0.1）。
 */
import { replaceAll } from '../lib/sqlite-mirror.js'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sea = (process.argv[2] || '').trim()
if (!sea) {
  console.log('用法：node scripts/mirror-sync.mjs <识海名>')
  process.exit(1)
}

const file = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(file)) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}

const d = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const r = replaceAll(sea, d.points || [], d.edges || [])
// 2026-11-21：失败时只说一句「失败」，错在哪一句都不说。
if (!r || !r.ok) {
  console.log(`镜像重建 ${sea}：失败 · ${(d.points || []).length} 条没写进去`)
  if (r && r.err) console.log('原因：' + r.err)
  process.exit(1)
}
console.log(`镜像重建 ${sea}：成功 · ${(d.points || []).length} 条`)
// 重建成功不等于对上了——今晚实测：这边报成功，一致性那份照样红。
// 所以每次重建完都提醒去复核，别拿「成功」当「一致」。
console.log(`去复核：node scripts/sqlite-parity.mjs ${sea}（成功只代表重写完了，不代表两边一致）`)
process.exit(0)
