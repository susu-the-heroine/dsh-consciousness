/**
 * 重启之后一条命令看全
 * =====================
 *   node scripts/after-restart-verdict.mjs
 *
 * 为什么要有：这半天改了六处，每处都要重启才生效；一条一条手跑容易漏。
 * 它只做「下结论」这件事：五条硬判据，全过就打绿，有一条不过就点名。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LOG = join(homedir(), '.dsh', 'consciousness-audit.log')
const rows = existsSync(LOG)
  ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  : []
const boot = rows.filter((r) => r.k === 'boot-0-webServer').slice(-1)[0]
const bootAt = boot ? Number(boot.t) : 0
const mins = bootAt ? ((Date.now() - bootAt) / 60000) : 0
const win = rows.filter((r) => Number(r.t) >= bootAt)
const main = win.filter((r) => String(r.sea || '') === 'main')
const count = (arr, k) => arr.filter((r) => r.k === k).length

console.log('重启之后一条命令看全')
console.log('  本次启动：' + (bootAt ? new Date(bootAt).toLocaleString('zh-CN') + '（已跑 ' + mins.toFixed(1) + ' 分钟）' : '没找到启动记录'))
console.log('')

const verdicts = []
const say = (ok, text) => { verdicts.push(ok); console.log('  ' + (ok ? '过  ' : '不过  ') + text) }

// 一、主海有没有真写
const writes = main.filter((r) => /^write-/.test(String(r.k)))
const released = main.filter((r) => r.k === 'write-lock-released')
say(writes.length > 0, '主海这期间有真实写入（写/锁审计 ' + writes.length + ' 条、放锁 ' + released.length + ' 次）')

// 二、主海还有没有留锁
const stale = main.filter((r) => r.k === 'write-lock-self-stale')
const staleNew = stale.filter((r) => r.ageMs != null)
say(stale.length === 0, '主海锁过期 ' + stale.length + ' 次' + (stale.length && !staleNew.length ? '（全是旧账，没锁龄字段）' : ''))

// 三、放锁失败有没有
const fail = win.filter((r) => r.k === 'write-lock-release-failed')
say(fail.length === 0, '放锁失败 ' + fail.length + ' 次')

// 四、看守有没有在收拾残锁（有也可以，但要看得见）
const jan = win.filter((r) => r.k === 'write-lock-janitor')
console.log('  · 看守收走残锁 ' + jan.length + ' 次' + (jan.length ? '（最近 ' + new Date(Number(jan.slice(-1)[0].t)).toLocaleTimeString('zh-CN') + '）' : ''))

// 五、总自检
let pass = 0
let total = 0
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'selftest-all.mjs')], { encoding: 'utf8' })
  const m = out.match(/共 (\d+) 组 · 通过 (\d+) · 失败 (\d+)/)
  if (m) { total = Number(m[1]); pass = Number(m[2]) }
} catch {}
say(total > 0 && pass === total, '总自检 ' + pass + '/' + total)

console.log('')
const bad = verdicts.filter((v) => !v).length
if (bad === 0) console.log('结论：这一趟全过。主海有写、没留锁、放锁没失败、自检全过。')
else console.log('结论：还有 ' + bad + ' 条不过，按上面点名的那几条去查。')