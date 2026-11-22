/**
 * 发布包体检：不该发的东西有没有混进去
 * ==================================
 *
 *   node scripts/release-audit.mjs [tgz 路径...]
 *
 * 不传参数就看 `~/Desktop/识海发版/*.tgz`。
 *
 * 为什么要有：`pack-split` 是"整棵树拷过去再排除"，默认是**发**。
 * 2026-11-15 凌晨真发生过：代码包里带着 `scripts/data` 下十七个评测语料，
 * 那些题是从他本人的记忆里抽的。差一步就把别人的私事发出去了。
 * 这个脚本把"不许出现在包里"的清单钉死，谁改打包器都跑一遍。
 */
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const FORBIDDEN = [
  { re: /(^|\/)scripts\/data(\/|$)/, why: '评测语料（从个人记忆里抽的题）' },
  { re: /人格与记忆_学习笔记\.md$/, why: '学习笔记（私人对话整理）' },
  { re: /(^|\/)docs\/[^/]*\.docx$/, why: '申报稿/材料（点了他名字、提了病史）' },
  { re: /\.bak|\.oldcode$|\.crashed\d*$|\.broken_|\.rollback_/, why: '备份/残件（含坏掉的 index 与回滚副本）' },
  { re: /(^|\/)node_modules(\/|$)/, why: '依赖目录（本插件零依赖）' },
  { re: /(^|\/)\.git(\/|$)/, why: '版本库' },
  { re: /consciousness-seas|consciousness-backups/, why: '真实识别海数据' },
]

const args = process.argv.slice(2)
let tgzs = args
if (!tgzs.length) {
  const dir = join(homedir(), 'Desktop', '识海发版')
  if (!existsSync(dir)) {
    console.log('没有发布目录，跳过。')
    process.exit(0)
  }
  // 只审本插件的包：那个目录里可能还躺着别的项目（比如嗓子那个），别替它报错
  tgzs = readdirSync(dir).filter((f) => f.startsWith('dsh-consciousness') && f.endsWith('.tgz')).map((f) => join(dir, f))
}
if (!tgzs.length) {
  console.log('没有 .tgz，跳过。')
  process.exit(0)
}

// 只对"当前版本"的包判生死：目录里躺着的历史包要是脏，只报警告并计数，
// 因为那些可能已经发出去了——警告比失败更能说明问题（2026-11-15 查出来的实情）。
const curVer = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version
let bad = 0
let oldDirty = 0
for (const f of tgzs) {
  if (!existsSync(f)) { console.log(`缺文件：${f}`); bad++; continue }
  const sz = (statSync(f).size / 1048576).toFixed(1)
  const r = spawnSync('tar', ['-tzf', f], { encoding: 'utf8', timeout: 300000 })
  if (r.status !== 0) {
    console.log(`读不了（tar 失败）：${f}`)
    bad++
    continue
  }
  // Windows 的 tar 输出是 CRLF；不去 \r，逐行比对会全部落空（刚踩过）
  const list = String(r.stdout || '').split('\n').map((x) => x.replace(/\r$/, '')).filter(Boolean)
  const hits = []
  for (const line of list) {
    const p = line.replace(/^package\//, '')
    for (const f2 of FORBIDDEN) if (f2.re.test(p)) { hits.push(`${f2.why}：${p}`); break }
  }
  // 关键件只对"代码包"要求——模型包本来就只有 assets/embed
  const isCode = /-code\./.test(f)
  const must = isCode ? ['index.js', 'package.json', 'lib/store.js', 'lib/vectors.js'] : []
  const missing = must.filter((m) => !list.some((x) => x === 'package/' + m))
  console.log(`${f.split('\\').pop()}：${sz} MB · 条目 ${list.length} · 不该发的 ${hits.length} · 缺关键件 ${missing.length}`)
  for (const h of hits.slice(0, 8)) console.log('   · ' + h)
  for (const m of missing) console.log('   · 缺：' + m)
  const isCurrent = f.includes(curVer)
  if (hits.length || missing.length) {
    if (isCurrent) bad++
    else { oldDirty++; console.log('   ↑ 这是旧版包，可能已经发出去过') }
  }
}

console.log(bad ? '当前版本的包有问题，先别发。' : '当前版本干净：只有代码和文档，没有私人语料。')
if (oldDirty) console.log(`另有 ${oldDirty} 个旧版包不干净——历史发出去的，可能需要回收或说明。`)
process.exit(bad ? 1 : 0)
