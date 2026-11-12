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
const raw = JSON.parse(readFileSync(p, 'utf8'))
let n = 0
for (const k of Object.keys(raw)) {
  if (raw[k] && raw[k].sv) { delete raw[k].sv; n++ }
}
if (!n) { console.log('里面没有 sv，什么都不用做'); process.exit(0) }
const bak = p + '.bak-sv-' + Date.now()
copyFileSync(p, bak)
// 紧凑写回，别留缩进
writeFileSync(p, JSON.stringify(raw), 'utf8')
const before = readFileSync(bak).length
const after = readFileSync(p).length
console.log(`清了 ${n} 条 sv · ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`)
console.log('备份:', bak.split(/[\\/]/).pop())
