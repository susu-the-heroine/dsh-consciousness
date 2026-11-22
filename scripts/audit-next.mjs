/**
 * 下一份读哪 —— 审计进度表
 * ========================
 *
 *   node scripts/audit-next.mjs          看下一份
 *   node scripts/audit-next.mjs 5        看前五份
 *   node scripts/audit-next.mjs --write  顺便把进度写进 docs/审计进度.json
 *
 * 为什么要有这个：这一晚两次报错下一份文件名（一次报了个根本不存在的文件，
 * 一次只报「只剩两份」其实是按子目录数的）。凭记忆报文件，就是会错。
 * 所以把「判进度」这件事从脑子挪到脚本里：只认账里写过「逐行嚼：xxx」的，
 * 记糊了的都算没读；按行数从大到小排，先啃大的。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, statSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LEDGER = join(ROOT, 'docs', '问题总表-1119.md')
const PROGRESS = join(ROOT, 'docs', '审计进度.json')

// 数据表与第三方目录不算逐行读的份
const SKIP_DIRS = new Set(['node_modules', 'assets', '_local-backups', '.git', 'dist'])
const SKIP_FILES = new Set(['pinyin-map.js'])

function walk(dir, out = []) {
  let ents = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(join(dir, e.name), out)
    } else if (/\.(mjs|js)$/.test(e.name) && !SKIP_FILES.has(e.name)) {
      out.push(join(dir, e.name))
    }
  }
  return out
}

// 2026-11-21：按换行切段数行，末尾那个换行会多算一行——每个以换行结尾的文件都虚报一行。
// 实测：脚本自己说八十二条的文件，编辑器里是八十一条。数行是为了排顺序和报进度，虚一行就是虚一片。
// 改成「换行个数 + 末行不是换行才算一行」。
const countLines = (f) => {
  try {
    const t = readFileSync(f, 'utf8')
    if (!t) return 0
    let n = 0
    for (let i = 0; i < t.length; i++) if (t[i] === '\n') n++
    if (!t.endsWith('\n')) n++
    return n
  } catch { return 0 }
}

const ledger = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : ''
const audited = new Set(
  // 2026-11-21：原来只认「字母数字点横线」拼的路径。目录名是中文的（比如 给他/…）就匹配不上，
  // 于是那份明明进过账，却被永远算作「没读」，一遍遍报出来。改成取最后一个斜杠后面的文件名。
  [...ledger.matchAll(/逐行嚼：[^\n：]*?([^\/\s：]+\.(?:mjs|js))/g)].map((m) => m[1]),
)

const all = walk(ROOT).map((f) => ({
  rel: f.slice(ROOT.length + 1).replace(/\\/g, '/'),
  name: basename(f),
  lines: countLines(f),
})).filter((x) => x.lines > 0)

const left = all
  .filter((x) => !audited.has(x.name))
  .sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel))

const done = all.length - left.length
const leftLines = left.reduce((s, x) => s + x.lines, 0)

console.log('代码文件 ' + all.length + ' 份：账里读过 ' + done + ' 份，还剩 ' + left.length + ' 份，合计 ' + leftLines + ' 行')
console.log('')
const n = Math.max(1, Math.min(50, Number(process.argv[2]) || 5))
for (const x of left.slice(0, n)) console.log('  ' + String(x.lines).padStart(5) + ' 行  ' + x.rel)

if (process.argv.includes('--write')) {
  const data = {
    updatedAt: new Date().toISOString(),
    total: all.length,
    audited: done,
    left: left.length,
    leftLines,
    next: left.slice(0, 20).map((x) => ({ rel: x.rel, lines: x.lines })),
  }
  writeFileSync(PROGRESS, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log('')
  console.log('进度写进 docs/审计进度.json：下一份 ' + (left[0] ? left[0].rel : '（全部读完）'))
}
