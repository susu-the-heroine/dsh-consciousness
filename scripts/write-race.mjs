import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 四个进程同时往一个识海写
 * ======================
 *
 *   node scripts/write-race.mjs [识海] [每个进程写几次] [进程数]
 *
 * 默认：sandbox 海、每进程 15 次、4 个进程。
 * 判据三条：最后能解析、条数没变、没有半截文件。
 *
 * 2026-11-14 夜：审计说主写路径没有锁。那天补了"尽力而为的锁"，
 * 这个脚本是拿来现形的——没有它，锁只是我嘴上说有。
 */
import { spawnSync } from 'node:child_process'
import { isMainSea } from './_guard-main.mjs'

import { readFileSync, existsSync, readdirSync, mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'sandbox').trim() || 'sandbox'
const times = Math.max(1, Math.min(50, Number(process.argv[3]) || 15))
const workers = Math.max(1, Math.min(8, Number(process.argv[4]) || 4))

// 2026-11-19：以前直接在真沙箱海里造数据、跑完不还原。
// 现在整条链路搬进临时家目录：先拷一份沙箱海过去，写完只动那份。
const REAL_HOME = homedir()   // 必须在改 USERPROFILE 之前取，homedir 会缓存
const REAL_SEA = join(REAL_HOME, '.dsh', 'consciousness-seas', sea, 'data.json')
const TMP_HOME = mkdtempSync(join(tmpdir(), 'sea-race-'))
process.env.USERPROFILE = TMP_HOME
// 2026-11-21：只改用户目录、没改家目录。这台机器够用，换个系统取家目录看的是 HOME。
process.env.HOME = TMP_HOME
const D = join(TMP_HOME, '.dsh')
const file = join(D, 'consciousness-seas', sea, 'data.json')

if (isMainSea(sea)) {
  console.log('拒绝：只对沙箱海跑，不许碰 main。')
  process.exit(1)
}

if (!existsSync(file)) {
  if (!existsSync(REAL_SEA)) {
    console.log('没有这个识海：' + sea + '（真沙箱里也没有可拷的）')
    process.exit(1)
  }
  const src = join(REAL_HOME, '.dsh', 'consciousness-seas', sea)
  const dst = join(D, 'consciousness-seas', sea)
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, { recursive: true })
}

// 子进程模式：闷头写
if (process.argv[5] === '--worker') {
  const { writeSea } = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
  const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  let ok = 0
  for (let i = 0; i < times; i++) {
    const d = JSON.parse(JSON.stringify(raw))
    if (d.points && d.points[0]) d.points[0].title = `race-${process.pid}-${i}`
    if (writeSea(sea, d) === true) ok++
  }
  console.log(ok)
  process.exit(0)
}

if (!existsSync(file)) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}
const before = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).points.length

const kids = []
for (let w = 0; w < workers; w++) {
  kids.push(spawnSync(_nodeBin, [fileURLToPath(import.meta.url), sea, String(times), String(workers), '--worker'], {
    encoding: 'utf8', timeout: 300000, env: { ...process.env, USERPROFILE: TMP_HOME, HOME: TMP_HOME },
  }))
}

let writes = 0
let failedKids = 0
for (const k of kids) {
  if (k.status !== 0) { failedKids++; continue }
  writes += Number(String(k.stdout).trim().split('\n').pop()) || 0
}

let parsed = true
let after = -1
try {
  after = JSON.parse(readFileSync(file, 'utf8')).points.length
} catch {
  parsed = false
}

const dir = join(D, 'consciousness-seas', sea)
const tmps = readdirSync(dir).filter((f) => f.endsWith('.tmp'))
const lock = existsSync(join(dir, 'data.json.lock'))

console.log(`进程 ${workers} 个 × 每次 ${times} 写 · 成功写入 ${writes} · 子进程失败 ${failedKids}`)
console.log(`条数 ${before} → ${after} · 能解析 ${parsed ? '是' : '不是'} · 残留 tmp ${tmps.length} · 锁还挂着 ${lock ? '是' : '否'}`)

const bad = !parsed || after !== before || tmps.length > 0 || failedKids > 0
console.log(bad ? '有问题的，看上面哪条不对。' : '没写坏：条数没变、文件能解析、没留半截。')
try { rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}   // 临时家目录不留在 %TEMP%
process.exit(bad ? 1 : 0)
