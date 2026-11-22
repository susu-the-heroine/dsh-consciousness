/**
 * 脚本安全审计：谁可能写到真库
 * ============================
 *   node scripts/sea-guard-audit.mjs
 *
 * 铁规矩：测试只碰沙箱海。做法是先把 HOME/USERPROFILE 指到临时目录，再 import 库函数。
 * 这个脚本扫 scripts/ 下所有 .mjs：
 *   · 只要出现 writeSea / addTool / autoThink 这类写入口，
 *   · 就必须在同一个文件里看到 USERPROFILE 或 HOME 被设成 tmp 目录；
 *   · 或者显式 import 了 _guard-main.mjs（那份会拦真库写入）。
 * 少了这两样，就是「一跑就可能改到他的库」，必须报出来。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：原来按「当前目录 + scripts」找，换个目录一跑就抛 ENOENT——
// 实测在盘根跑：读目录直接炸，退出码一，什么都没扫。改成按本文件所在位置找。
const DIR = dirname(fileURLToPath(import.meta.url))
const WRITE_API = /writeSea\s*\(|addTool\.execute|autoThinkOnce\s*\(|recordDims\s*\(|bindSession\s*\(/
const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs'))
const bad = []
let scanned = 0

for (const f of files) {
  if (f.startsWith('_')) continue
  let src = ''
  try { src = readFileSync(join(DIR, f), 'utf8') } catch { continue }
  if (!WRITE_API.test(src)) continue
  scanned++
  // 只盯两类：测试/仿真脚本，且会碰主海。
  // 维护工具（合并重复、补别名、迁移字段）本来就是对着真库跑的，不算违规。
  if (!/test|sim/i.test(f)) continue
  const touchesMain = /['"]main['"]/.test(src)
  if (!touchesMain) continue
  const setsHome = /USERPROFILE\s*=|HOME\s*=/.test(src)
  const usesGuard = /_guard-main/.test(src)
  // 父子式脚本：父进程开临时家目录，再带 env 拉起子进程（first-hour / fresh-home 都这么干），也算隔离。
  const spawnsInto = /mkdtempSync/.test(src) && /env\s*:/.test(src)
  const isLibSelf = /本文件|自测.*lib/.test(src) && !setsHome
  if (!setsHome && !usesGuard && !spawnsInto) bad.push({ f, why: isLibSelf ? '疑似直接跑真库' : '既没改 HOME 也没挂守卫' })
}

console.log(`扫了 ${files.length} 个脚本，其中 ${scanned} 个会调用写入口；关心里面碰到主海的那些。`)
if (bad.length) {
  console.log('这些没把库指到沙箱，跑起来可能动真库：')
  for (const b of bad) console.log(`  · ${b.f}（${b.why}）`)
} else {
  console.log('所有会写的脚本都先指到沙箱，或者挂了真库守卫。')
}
process.exit(bad.length ? 1 : 0)
