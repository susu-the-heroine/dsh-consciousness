/**
 * 锁的隔离测试
 * ============
 *
 * 不谈写入，只测一把锁：六个进程各抢二十次，每次拿住 20 毫秒。
 * 关键看：有没有两个进程同时"持锁"（时间窗重叠）。
 *
 * 跑法：node scripts/lock-isolation-test.mjs
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const N = 6
const ROUNDS = 20
const HOLD = 100   // 100 毫秒：Windows 时钟精度约 15.6 毫秒，20 毫秒测不准

if (process.argv.includes('--worker')) {
  const w = process.argv[process.argv.indexOf('--worker') + 1]
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
  const log = process.env.LOCK_LOG
  let got = 0
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = Number(process.hrtime.bigint() / 1000000n)
    const lock = S.lockSea('main')
    const t1 = Number(process.hrtime.bigint() / 1000000n)
    if (!lock.ok) continue
    got++
    appendFileSync(log, JSON.stringify({ w, i, got: t1, wait: t1 - t0 }) + '\n', 'utf8')
    const until = Number(process.hrtime.bigint() / 1000000n) + HOLD
    while (Number(process.hrtime.bigint() / 1000000n) < until) { /* 持锁：时钟要和上面一致 */ }
    S.unlockSea(lock)
  }
  process.exit(got === ROUNDS ? 0 : 3)
}

const home = mkdtempSync(join(tmpdir(), 'lockiso-'))
const log = join(home, 'lock.log')
const env = { ...process.env, USERPROFILE: home, HOME: home, LOCK_LOG: log }
writeEmpty(log)

const runs = []
for (let t = 0; t < N; t++) {
  runs.push(new Promise((resolve) => {
    const c = spawn(process.execPath, [SELF, '--worker', String(t)], { env, windowsHide: true })
    let err = ''
    c.stderr.on('data', (d) => { err += String(d) })
    c.on('close', (code) => resolve({ t, code, err }))
  }))
}
const res = await Promise.all(runs)

const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
const rows = lines.map((l) => JSON.parse(l))
console.log(`进程完成 ${res.filter((r) => r.code === 0).length}/${N} · 抢到锁 ${rows.length}/${N * ROUNDS}`)

// 谁抢到了、谁的时间窗跟别人重叠
rows.sort((a, b) => a.got - b.got)
let overlaps = 0
let prev = null
const pairs = []
for (const r of rows) {
  if (prev && r.got < prev.got + HOLD) {
    overlaps++
    if (pairs.length < 10) pairs.push(`w${prev.w}@${prev.got} → w${r.w}@${r.got} 差 ${r.got - prev.got}ms`)
  }
  prev = r
}
for (const p2 of pairs) console.log('  重叠:', p2)
const waits = rows.map((r) => r.wait || 0).sort((a, b) => a - b)
console.log(`等锁耗时 中位 ${waits[Math.floor(waits.length / 2)]}ms · 最长 ${waits[waits.length - 1]}ms`)
console.log(`时间窗重叠次数：${overlaps}（0 才是真互斥）`)

const perWorker = new Map()
for (const r of rows) perWorker.set(r.w, (perWorker.get(r.w) || 0) + 1)
console.log('各进程抢到次数：', [...perWorker.entries()].map(([w, n]) => `${w}:${n}`).join(' '))

rmSync(home, { recursive: true, force: true })
process.exit(overlaps === 0 && rows.length === N * ROUNDS ? 0 : 1)

function writeEmpty(f) {
  // 建个空文件，避免 worker 第一次 append 时目录不存在
  appendFileSync(f, '', 'utf8')
}
