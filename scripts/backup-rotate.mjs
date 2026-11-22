/**
 * 备份轮转：每个海只留最近十份备份
 * ==================================
 *   node scripts/backup-rotate.mjs          # 只看会删哪些
 *   node scripts/backup-rotate.mjs --apply  # 真删
 *
 * 只动 *.bak* 这类备份文件，data.json / vectors 本体一律不碰。
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ROOT = join(homedir(), '.dsh', 'consciousness-seas')
const KEEP = 10
const apply = process.argv.includes('--apply')

let totalRemoved = 0
let totalKept = 0
let seasSeen = 0
for (const sea of readdirSync(ROOT)) {
  const dir = join(ROOT, sea)
  let st
  try { st = statSync(dir) } catch { continue }
  if (!st.isDirectory()) continue
  seasSeen++
  const baks = readdirSync(dir).filter((f) => /\.bak([-.]|$)/.test(f))
    .map((f) => { try { return { f, t: statSync(join(dir, f)).mtimeMs } } catch { return null } })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
  if (baks.length <= KEEP) { totalKept += baks.length; continue }
  const drop = baks.slice(KEEP)
  totalKept += KEEP
  for (const x of drop) {
    if (apply) { try { unlinkSync(join(dir, x.f)) } catch {} }
    totalRemoved++
  }
  console.log(`${sea}：${baks.length} 份 → 留 ${Math.min(KEEP, baks.length)}，${apply ? '删' : '将删'} ${drop.length}`)
}
// 2026-11-21：原来只说「留 10 份、将删 0 份」——分不清是「真没有该删的」
// 还是「一个海都没扫到」。把扫到的海数说出来，零才是可信的零。
console.log(`扫了 ${seasSeen} 个海 · 合计：留 ${totalKept} 份，${apply ? '删' : '将删'} ${totalRemoved} 份${apply ? '' : '（加 --apply 真删）'}`)
if (!seasSeen) console.log('一个海都没扫到——先看海目录在不在：' + ROOT)
