/**
 * 把 vectors.json 里的 sv（短文本向量）清掉
 * =========================================
 * 2026-11-12：短文本那一路试了两次都没用上，留着的 sv 让文件从 0.9 MB 涨到 1.8 MB。
 * 主向量 v 原样保留，只删 sv。先备份。
 *
 * 跑法：node scripts/strip-sv.mjs <vectors.json 路径>
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const p = process.argv[2]
if (!p || !existsSync(p)) {
  console.log('给个存在的路径:', p)
  process.exit(1)
}
// 2026-11-21：文件开头带一个字节序标记就崩在第一个字符上（实测）。
// 别的脚本都剥，这份没剥。先剥再解析；解析不了说人话，别甩栈。
let raw
try {
  raw = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
} catch (e) {
  console.log('这份向量文件读不出来：' + p)
  console.log(String((e && e.message) || e).slice(0, 120))
  console.log('没动它，一个字节都没改。')
  process.exit(2)
}
let n = 0
for (const k of Object.keys(raw)) {
  if (raw[k] && raw[k].sv) { delete raw[k].sv; n++ }
}
if (!n) { console.log('里面没有 sv，什么都不用做'); process.exit(0) }
const bak = p + '.bak-sv-' + Date.now()
copyFileSync(p, bak)
// 紧凑写回，别留缩进
writeFileSync(p, JSON.stringify(raw), 'utf8')
// 2026-11-21：写完不验——万一写坏，备份在手也得有人去回滚。写完当场解析一遍，
// 主向量那条还得在，不然就是拿「删干净了」换掉了「文件还活着」。
let back = null
try { back = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch {}
if (!back) {
  console.log('写完之后读不回来了——没敢继续，备份在这儿：' + bak)
  process.exit(2)
}
const left = Object.keys(back).filter((k) => back[k] && back[k].v)
if (!left.length) console.log('注意：写完之后一条主向量都不剩了，先别用这份文件。')
const before = readFileSync(bak).length
const after = readFileSync(p).length
console.log(`清了 ${n} 条 sv · ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`)
console.log('备份:', bak.split(/[\\/]/).pop())
