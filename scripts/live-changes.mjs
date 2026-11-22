/**
 * 哪些改动还在等重启
 * ================
 * 启动时刻自动识别：审计里最大的那段空档之后的第一条，就是进程起来的时候。
 * 进程起之后改的 js/mjs，都还没进活的那一份。
 *
 *   node scripts/live-changes.mjs                （自动认启动时刻）
 *   node scripts/live-changes.mjs 2026-11-21T14:18:49+08:00   （手动指定）
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function bootFromAudit() {
  const p = join(homedir(), '.dsh', 'consciousness-audit.log')
  if (!existsSync(p)) return 0
  const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  if (rows.length < 2) return 0
  // 2026-11-21：取「最近一次」空档，不是全日志最大那次——夜里停了一整晚，
  // 最大空档在昨晚，会把启动时刻认成凌晨两点。
  let at = 0
  for (let i = rows.length - 1; i > 0; i--) {
    const gap = Number(rows[i].t) - Number(rows[i - 1].t)
    if (gap > 60 * 1000) { at = Number(rows[i].t); break }
  }
  return at
}

const arg = process.argv[2]
let boot = arg ? new Date(arg).getTime() : bootFromAudit()
if (!boot) { console.log('认不出启动时刻：传一个，例如 node scripts/live-changes.mjs "2026-11-21T14:18:49+08:00"'); process.exit(2) }
const scan = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [] : [join(d, e.name)]))
const files = [...scan(join(ROOT, 'lib')), ...scan(join(ROOT, 'scripts'))].filter((f) => /\.(js|mjs)$/.test(f))
const after = files.filter((f) => statSync(f).mtimeMs > boot).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
console.log('启动时刻 ' + new Date(boot).toLocaleString('zh-CN') + '（' + (arg ? '手动给' : '从审计空档认出来') + '）')
console.log('之后改过、还没进活进程的：' + after.length + ' 个')
for (const f of after) console.log('  ' + new Date(statSync(f).mtimeMs).toLocaleTimeString('zh-CN') + '  ' + f.replace(ROOT + '\\', ''))
console.log('之前就在、已经在跑的：' + (files.length - after.length) + ' 个')