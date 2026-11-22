/**
 * 每个识海都还读得出来吗（2026-11-21 改：原来写「十二个」，实测已是二十四个——
 * 数会变，别把数写进标题）
 * ======================
 *
 *   node scripts/seas-check.mjs
 *
 * 只读：每个识海的 data.json 能不能解析、条数多少、有没有半截文件（.tmp 残留）。
 * 2026-11-14 夜加。理由是那晚我发现"某个脚本读库读坏了会静默变成 0 条"，
 * 所以得有一个地方能一眼看出"这个海还有没有数据"。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
if (!existsSync(SEAS)) {
  console.log('没有识海目录')
  process.exit(1)
}

const rows = []
let bad = 0
for (const name of readdirSync(SEAS)) {
  const dir = join(SEAS, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const f = join(dir, 'data.json')
  if (!existsSync(f)) { rows.push([name, '缺 data.json', 0, 0]); bad++; continue }
  let d = null
  try {
    d = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    rows.push([name, '读不出来', 0, 0]); bad++; continue
  }
  const pts = (d.points || []).length
  const edges = (d.edges || []).length
  const tmp = readdirSync(dir).filter((x) => x.endsWith('.tmp')).length
  rows.push([name, tmp ? '有 ' + tmp + ' 个 .tmp 残留' : 'ok', pts, edges])
}

rows.sort((a, b) => b[2] - a[2])
console.log('识海名'.padEnd(16) + '状态'.padEnd(20) + '点    边')
for (const [n, s, p, e] of rows) {
  console.log(String(n).padEnd(16) + String(s).padEnd(20) + String(p).padEnd(6) + e)
}
console.log(`\n共 ${rows.length} 个海 · 有问题的 ${bad} 个`)
process.exit(bad === 0 ? 0 : 1)
