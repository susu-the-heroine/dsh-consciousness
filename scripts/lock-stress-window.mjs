/**
 * 锁的加速窗口：用真负载顶掉「干等两小时」
 * ======================================
 *   node scripts/lock-stress-window.mjs [轮数，默认 120]
 *
 * 为什么写这个：条目要的是「活进程里攒两小时、真漏保持零」。
 * 干等两小时换不来信息量；造真负载来得更狠——每一轮都让另一个进程
 * 随机占锁 0.2–2.5 秒（模拟备份那种慢写），我这边同时抢着写。
 *
 * 判定：这窗里「持有者还活着却被拆」（self-stale 且 holderAlive=true）必须是 0。
 * 只碰沙箱海；主海只读审计日志。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

process.env.C2_NO_REFUSAL_LOG = '1'
const S = await import('file:///' + join(process.cwd(), 'lib', 'store.js').replace(/\\/g, '/'))
const SEA = 'sandbox'
const ROUNDS = Number(process.argv[2] || 120)

const auditPath = join(homedir(), '.dsh', 'consciousness-audit.log')
const rows = () => readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

const t0 = Date.now()
let stolen = 0
let waits = 0
let written = 0

for (let i = 0; i < ROUNDS; i++) {
  const holdMs = 200 + Math.floor(Math.random() * 2300)
  const child = spawn(process.execPath, ['-e', `
    const { mkdirSync, writeFileSync, unlinkSync } = require('node:fs')
    const { join } = require('node:path')
    const { homedir } = require('node:os')
    const dir = join(homedir(), '.dsh', 'consciousness-seas', '${SEA}')
    const p = join(dir, 'data.json.lock')
    try { mkdirSync(dir, { recursive: true }) } catch (e) {}
    writeFileSync(p, JSON.stringify({ pid: process.pid, t: Date.now() }))
    setTimeout(() => { try { unlinkSync(p) } catch (e) {} process.exit(0) }, ${holdMs})
  `], { stdio: 'ignore' })

  await new Promise((r) => setTimeout(r, 30))
  const d = S.readSea(SEA)
  const id = 996000 + i
  d.points.push({ id, title: '锁压测临时 ' + i, text: '压测用，跑完删。', kind: 'fact', born: Date.now(), seen: 0 })
  S.writeSea(SEA, d)
  written++

  if (S.readSea(SEA).points.some((p) => Number(p.id) === id)) {
    const d2 = S.readSea(SEA)
    d2.points = d2.points.filter((p) => Number(p.id) !== id)
    S.writeSea(SEA, d2)
  }
  await new Promise((r) => child.on('exit', r))
}

const win = rows().filter((r) => Number(r.t) >= t0 && String(r.sea || '') === SEA)
stolen = win.filter((r) => r.k === 'write-lock-self-stale' && r.holderAlive === true).length
waits = win.filter((r) => r.k === 'write-lock-reentrant-wait').length
const corpse = win.filter((r) => r.k === 'write-lock-self-stale' && r.holderAlive !== true).length

console.log('  轮数：' + ROUNDS + ' · 写成功：' + written + ' · 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒')
console.log('  真漏（活人锁被拆）：' + stolen)
console.log('  排队等待：' + waits + ' 次 · 收尸（持有者已死）：' + corpse + ' 次')
console.log('  判定：' + (stolen === 0 && written === ROUNDS ? '过——慢写都被等过去了，没有一次抢活人锁' : '不过——有活人锁被拆或写入失败'))
process.exit(stolen === 0 && written === ROUNDS ? 0 : 1)
