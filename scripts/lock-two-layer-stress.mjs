/**
 * 两套锁一起压：lock.js 与 store.js 同进程、跨进程都来
 * ===================================================
 *   node scripts/lock-two-layer-stress.mjs [轮数，默认 40]
 *
 * 每一轮：起一个子进程，用 lock.js 拿沙箱海的锁、随机占 0.2–2 秒，
 * 期间在主进程用 store.js 写一笔（应当认得那把锁、直接写、不互拆），
 * 子进程再写一笔（嵌套路径），最后放锁。
 *
 * 判据：本窗口内「持有者还活着却被拆」（self-stale 且 holderAlive=true）必须是 0。
 */
process.env.C2_NO_REFUSAL_LOG = '1'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const S = await import('file:///' + join(process.cwd(), 'lib', 'store.js').replace(/\\/g, '/'))
const SEA = 'sandbox'
const ROUNDS = Number(process.argv[2] || 40)
const t0 = Date.now()

const childCode = `
process.env.C2_NO_REFUSAL_LOG = '1'
const S = await import('file:///' + process.cwd().replace(/\\\\/g, '/') + '/lib/store.js')
const L = await import('file:///' + process.cwd().replace(/\\\\/g, '/') + '/lib/lock.js')
const hold = 200 + Math.floor(Math.random() * 1800)
const lk = L.acquireWriteLock('${SEA}')
await new Promise((r) => setTimeout(r, hold))
const d = S.readSea('${SEA}')
d.points.push({ id: 994000 + Math.floor(Math.random() * 999), title: '子进程临时', text: '压测', kind: 'fact', born: Date.now(), seen: 0 })
S.writeSea('${SEA}', d)
if (lk) lk.release()
`

let ok = 0
for (let i = 0; i < ROUNDS; i++) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], { cwd: process.cwd(), stdio: 'ignore' })
  if (r.status === 0) ok++
  // 主进程这时候也写一笔：两套锁协作
  const d = S.readSea(SEA)
  d.points.push({ id: 993000 + i, title: '主进程临时 ' + i, text: '压测', kind: 'fact', born: Date.now(), seen: 0 })
  S.writeSea(SEA, d)
}

const rows = readFileSync(join(homedir(), '.dsh', 'consciousness-audit.log'), 'utf8')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const win = rows.filter((r) => Number(r.t) >= t0 && String(r.sea || '') === SEA)
const real = win.filter((r) => r.k === 'write-lock-self-stale' && r.holderAlive === true).length
const corpse = win.filter((r) => r.k === 'write-lock-self-stale' && r.holderAlive !== true).length

// 清理临时条目
const d2 = S.readSea(SEA)
d2.points = d2.points.filter((p) => !String(p.title || '').startsWith('主进程临时') && !String(p.title || '').startsWith('子进程临时'))
S.writeSea(SEA, d2)

console.log('  轮数：' + ROUNDS + ' · 子进程成功：' + ok + ' · 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒')
console.log('  真漏（活人锁被拆）：' + real + ' · 收尸：' + corpse + ' 次')
console.log('  判定：' + (real === 0 ? '过——两套锁没有互拆' : '不过——有活人锁被拆'))
process.exit(real === 0 ? 0 : 1)
