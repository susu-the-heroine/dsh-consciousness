/**
 * 发给别人之前，扫一遍这个文件夹
 * ==============================
 *
 *   node scripts/share-check.mjs [目录]
 *
 * 不传参数就扫"装好的那份插件"（`~/.dsh/profiles/desktop/node_modules/dsh-consciousness2`）。
 *
 * 为什么：`release-audit` 只管 .tgz；可你更可能干的事是——把整个文件夹压缩发给朋友。
 * 那份东西里有你的评测语料、你的笔记，他自己看不出来。
 */
import { readdirSync, existsSync, statSync, readFileSync, readlinkSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-consciousness2')
const root = (process.argv[2] || DEFAULT).trim()

const FORBIDDEN = [
  { re: /(^|\/)scripts\/data(\/|$)/, why: '评测语料（从个人记忆里抽的题）' },
  { re: /人格与记忆_学习笔记\.md$/, why: '学习笔记（私人对话整理）' },
  { re: /\.bak|\.oldcode$|\.crashed\d*$/, why: '备份残件' },
  { re: /consciousness-seas|consciousness-backups/, why: '真实识海数据' },
  { re: /(^|\/)\.git(\/|$)/, why: '版本库' },
  // 2026-11-21：这三样是他自己看的东西，整包发出去等于把自己的底细带出去。
  // 账里写着人名、身体、家里的事，心跳日志写着每晚干了什么，进度表写着还没读哪些。
  { re: /问题总表[^/]*\.md$/, why: '审计账（写着他的名字和家里的事）' },
  { re: /(^|\/)心跳\.log$/, why: '心跳日志（每晚干了什么）' },
  { re: /审计进度\.json$/, why: '审计进度快照' },
]

if (!existsSync(root)) {
  console.log('没有这个目录：' + root)
  process.exit(1)
}

// junction/软链说明：node_modules 里那份是链接到开发目录的，扫它等于扫源码。
// 源码里有语料是正常的（评测要用），发人要走 识海发版 里的 tgz。
let isLink = false
try { isLink = Boolean(statSync(root).isSymbolicLink && statSync(root).isSymbolicLink()) } catch {}
try { isLink = isLink || Boolean(readlinkSync(root)) } catch {}

const hits = []
let n = 0
const walk = (dir) => {
  let ents = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) { walk(abs); continue }
    n++
    const rel = relative(root, abs).replace(/\\/g, '/')
    for (const f of FORBIDDEN) if (f.re.test(rel)) { hits.push(`${f.why}：${rel}`); break }
  }
}
walk(root)

// 顺手告诉你"里面还剩多少条记忆"——正常应该是 0 条
let points = 0
try {
  const dp = join(root, 'assets', 'samples')
  if (existsSync(dp)) {
    for (const s of readdirSync(dp)) {
      const f = join(dp, s, 'data.json')
      if (!existsSync(f)) continue
      try {
        const d = JSON.parse(readFileSync(f, 'utf8'))
        points += Array.isArray(d.points) ? d.points.length : 0
      } catch {}
    }
  }
} catch {}

console.log(`扫 ${root}`)
console.log(`文件 ${n} 个 · 不该带的 ${hits.length} 项 · 示例海里的记忆 ${points} 条（这个可以有）`)
for (const h of hits.slice(0, 12)) console.log('  · ' + h)
if (hits.length > 12) console.log(`  …… 还有 ${hits.length - 12} 项`)
if (isLink) {
  console.log('注意：这个目录是链接，指向你的开发源码——里面有语料是正常的。')
  console.log('要发人请用 `识海发版` 里打好的 tgz，别整包发源码。')
} else {
  console.log(hits.length ? '先清掉这些再发。' : '干净，可以整包发人。')
}
process.exit(hits.length ? 1 : 0)
