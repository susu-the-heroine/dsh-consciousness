import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 两条写库路同抢一把锁
 * ==================
 *
 *   node scripts/lock-interop-test.mjs [识海] [每个进程写几次]
 *
 * 背景：库里有两份 writeSea（store.js 与 store-js.js），锁文件是同一个
 *   `data.json.lock`，但两边的"创建锁"手法原先不一样：
 *   store-js 用"临时文件 + 硬链接"，store.js 用 open('wx') 直接写内容。
 *   后者有一个瞬间文件是空的，前者的过期判定会把空文件当"过期锁"删掉——
 *   于是两个进程同时持锁，互相覆盖。
 *
 * 2026-11-14 夜把 store.js 也对齐成硬链接。这个测试拿两个进程分别走两条路，
 * 同时写同一个沙箱海，看会不会写坏。
 */
import { spawn } from 'node:child_process'
import { isMainSea } from './_guard-main.mjs'

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const sea = (process.argv[2] || 'sandbox').trim() || 'sandbox'
const times = Math.max(1, Math.min(50, Number(process.argv[3]) || 15))

const D = join(homedir(), '.dsh')
const dir = join(D, 'consciousness-seas', sea)
const file = join(dir, 'data.json')

if (isMainSea(sea)) {
  console.log('拒绝：只对沙箱海跑，不许碰 main。')
  process.exit(1)
}

if (process.argv[4] === '--worker') {
  const kind = process.argv[5] === 'storejs' ? 'storejs' : 'store'
  const mod = await import('file:///' + join(HERE, '..', 'lib', kind === 'storejs' ? 'store-js.js' : 'store.js').replace(/\\/g, '/'))
  const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  let ok = 0
  for (let i = 0; i < times; i++) {
    const d = JSON.parse(JSON.stringify(raw))
    if (d.points && d.points[0]) d.points[0].text = `${kind}-${process.pid}-${i}`
    let r
    try {
      if (kind === 'storejs') {
        // 这条路的接口是 lockSea() 拿锁、writeSea(sea,data,lock) 写、内部自己解锁。
        const lock = mod.lockSea(sea)
        if (!lock || !lock.ok) { r = false } else { r = mod.writeSea(sea, d, lock) }
      } else {
        r = mod.writeSea(sea, d)
      }
    } catch { r = false }
    if (r === true || (r && r.ok)) ok++
  }
  console.log(ok)
  process.exit(0)
}

if (!existsSync(file)) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}
const before = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).points.length

// 2026-11-21：这两条以前是 spawnSync 顺序跑——先写老路，等它跑完再写新路。
// 那测的从来不是「同时抢同一把锁」，是「先后各写一遍」。改成真并发。
const jobs = await Promise.all(
  [['store', 'store'], ['storejs', 'storejs']].map(([name, kind]) => new Promise((resolve) => {
    const c = spawn(_nodeBin, [SELF, sea, String(times), '--worker', kind], { windowsHide: true })
    let out = ''
    let err = ''
    c.stdout.on('data', (d) => { out += String(d) })
    c.stderr.on('data', (d) => { err += String(d) })
    c.on('close', (status) => resolve({ name, r: { status, stdout: out, stderr: err } }))
  })),
)

let writes = 0
let failed = 0
for (const { name, r } of jobs) {
  const n = Number(String(r.stdout || '').trim().split('\n').pop())
  if (r.status !== 0) { failed++; console.log(`${name} 子进程失败：${String(r.stderr || '').slice(0, 120)}`) }
  else writes += Number.isFinite(n) ? n : 0
}

let parsed = true
let after = -1
try { after = JSON.parse(readFileSync(file, 'utf8')).points.length } catch { parsed = false }
const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp') || f.startsWith('.lock-'))
const lock = existsSync(join(dir, 'data.json.lock'))

console.log(`两条路各写 ${times} 次 · 成功 ${writes} · 子进程失败 ${failed}`)
console.log(`条数 ${before} → ${after} · 能解析 ${parsed ? '是' : '不是'} · 残留 tmp/临时锁 ${leftovers.length} · 锁还挂着 ${lock ? '是' : '否'}`)

const bad = !parsed || after !== before || leftovers.length > 0 || failed > 0
console.log(bad ? '有问题的，看上面哪条不对。' : '两条路抢同一把锁，没写坏。')
process.exit(bad ? 1 : 0)   // 2026-11-19：两个分支以前都是 0，这条检查永远绿
