/**
 * 锁的现场取证
 * ==============
 *   node scripts/lock-forensics.mjs [分钟数]
 *
 * 干什么：把「锁过期」和「放锁了」按时间摆在一起看，直接给结论：
 *   过期那行的锁龄（ageMs）几十毫秒 → 当场没放；
 *   几秒到几分钟 → 上一次崩留下的陈锁；
 *   前面最近一条 released 在它之前几秒 → 那次写放了锁，锁是别人留的。
 *
 * 为什么要有：查了三轮都在猜「谁留的」，加了两行账之后就不用猜了。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const logPath = join(homedir(), '.dsh', 'consciousness-audit.log')
if (!existsSync(logPath)) {
  console.log('没有审计日志：' + logPath)
  process.exit(0)
}
const mins = Number(process.argv[2]) || 240
const since = Date.now() - mins * 60000
const rows = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l) } catch { return null } })
  .filter((r) => r && Number(r.t) >= since)

const stale = rows.filter((r) => r.k === 'write-lock-self-stale')
const released = rows.filter((r) => r.k === 'write-lock-released')
const failed = rows.filter((r) => r.k === 'write-lock-release-failed')
const refused = rows.filter((r) => r.k === 'write-sea-lock-refused')
const timeout = rows.filter((r) => r.k === 'write-lock-timeout')

console.log(`最近 ${mins} 分钟：放锁 ${released.length} 次 · 锁过期 ${stale.length} 次 · 放锁失败 ${failed.length} 次 · 抢锁被拒 ${refused.length} 次 · 等锁超时 ${timeout.length} 次`)
if (!stale.length) {
  console.log('没有「锁过期」，这一趟干净。')
} else {
  console.log('')
  console.log('逐条对：')
  for (const s of stale) {
    const pid = s.pid == null ? '（旧账没记）' : s.pid
    const age = s.ageMs == null ? '（旧账没记）' : s.ageMs + ' 毫秒'
    const before = released.filter((r) => Number(r.t) <= Number(s.t)).slice(-1)[0]
    const gap = before ? ((Number(s.t) - Number(before.t)) / 1000).toFixed(1) + ' 秒前刚放过锁' : '此前没有放锁记录'
    let verdict = '分不清（旧账缺字段）'
    if (s.ageMs != null) {
      if (s.ageMs < 2000) verdict = '像当场没放（锁龄不到两秒）'
      else if (s.ageMs >= 120000) verdict = '像上一次崩留下的陈锁（锁龄两分钟以上）'
      else verdict = '像陈锁但不算久（两秒到两分钟）'
    }
    console.log(`  ${new Date(Number(s.t)).toLocaleTimeString('zh-CN')}  海=${s.sea || '?'}  pid=${pid}  锁龄=${age}  ${gap}  → ${verdict}`)
  }
}
if (failed.length) {
  console.log('')
  console.log('放锁失败那些（新账才会有）：')
  for (const f of failed.slice(-10)) console.log(`  ${new Date(Number(f.t)).toLocaleTimeString('zh-CN')}  海=${f.sea || '?'}  ${String(f.err || '').slice(0, 60)}`)
}