/**
 * 自查：哪些脚本会伸手去改真目录
 * ==============================
 *
 * 为什么要有这个：2026-11-21 凌晨，审 test/live.test.mjs 时我先跑后改，
 * 那份测试开篇就删真家目录里的热参数文件——他十九点三十八改过的那份没了。
 * 一个进程就能干出来的事，靠"读代码时仔细点"挡不住，得有把尺子。
 *
 * 判法（只认会写/删的，不冤枉只读的）：
 *   1. 文件里出现 homedir() 或 *Path() 这类「真路径」
 *   2. 同时出现写盘或删盘（writeFileSync / rmSync / unlinkSync / renameSync / copyFileSync / mkdirSync）
 *   3. 却没建临时目录（mkdtempSync）——那它就可能在真目录上下手
 *
 * 跑法：node scripts/guard-test-writes.mjs [--all]
 *   默认只查 test/（测试必须干净）；--all 连 scripts/ 一起看。
 * 退出码：有嫌疑就 1。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ALL = process.argv.includes('--all')

const REAL_PATH = /homedir\(\)|\b[a-zA-Z]*Path\(\)/
const WRITES = /\b(writeFileSync|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|appendFileSync)\b/
const SANDBOX = /mkdtempSync|DSH_TEST_HOME/

function walk(dir, out = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    const p = join(dir, n)
    let st = null
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (n.endsWith('.mjs')) out.push(p)
  }
  return out
}

const dirs = [join(ROOT, 'test')]
if (ALL) dirs.push(join(ROOT, 'scripts'))

const bad = []
let checked = 0
for (const d of dirs) {
  for (const f of walk(d)) {
    const rel = relative(ROOT, f).replace(/\\/g, '/')
    if (rel === 'scripts/guard-test-writes.mjs') continue
    let src = ''
    try { src = readFileSync(f, 'utf8') } catch { continue }
    checked++
    const touchesReal = REAL_PATH.test(src)
    const writes = WRITES.test(src)
    const sandboxed = SANDBOX.test(src)
    if (touchesReal && writes && !sandboxed) bad.push(rel)
  }
}

console.log(`查了 ${checked} 份（${ALL ? 'test + scripts' : 'test'}）`)
if (!bad.length) {
  console.log('没有嫌疑：会写盘的都先换了临时目录。')
  process.exit(0)
}
console.log(`\n嫌疑 ${bad.length} 份（碰真路径 + 会写盘 + 没换临时目录）：`)
for (const b of bad) console.log('  ' + b)
if (ALL) {
  // 2026-11-21：scripts 里这些大多本来就该写真库（清场、备份、迁移、造数据）。
  // 一起列出来是为了看全貌，不是判它们有错——别照着名单去改人家的正事。
  console.log('\n--all 模式下这份名单只是参考：scripts 里多数是职责所在，别当缺陷改。')
  console.log('真正必须干净的是 test/：测试不许碰真数据。')
  process.exit(0)
}
console.log('\n处理办法：先读它把哪几条路径写死，再在开头建临时家目录指过去（别直接跑）。')
process.exit(1)
