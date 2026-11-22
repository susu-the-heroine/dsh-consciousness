/**
 * 备份与残留收口：数一数，再清一清
 * ==================================
 *
 *   node scripts/backup-tidy.mjs          # 只看不删
 *   node scripts/backup-tidy.mjs --apply  # 删两类：data.json.tmp（断点残留）、7 天前的 .bak-*
 *
 * 备份本体（consciousness-backups/）由 store.js 的收口策略管，这里只管海目录里的残留。
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SEAS_DIR = join(homedir(), '.dsh', 'consciousness-seas')
const apply = process.argv.includes('--apply')
let del = 0
// 2026-11-21：只看不删那档，原来不数「会删几个」——加 --apply 前得自己数行。
// 现在干跑也数：数了就知道该不该真动。
let would = 0

for (const name of readdirSync(SEAS_DIR)) {
  const dir = join(SEAS_DIR, name)
  let st
  try { st = statSync(dir) } catch { continue }
  if (!st.isDirectory()) continue
  for (const f of readdirSync(dir)) {
    const fp = join(dir, f)
    if (f === 'data.json.tmp') {
      console.log('断点残留  ' + name + ' / ' + f)
      if (apply) { try { unlinkSync(fp); del++ } catch {} } else would++
      continue
    }
    if (/\.bak-/.test(f)) {
      const age = Date.now() - statSync(fp).mtimeMs
      if (age > 7 * 86400000) {
        console.log('旧 bak   ' + name + ' / ' + f + '（' + Math.round(age / 86400000) + ' 天）')
        if (apply) { try { unlinkSync(fp); del++ } catch {} } else would++
      } else {
        console.log('新 bak   ' + name + ' / ' + f + '（' + Math.round(age / 86400000) + ' 天，先留）')
      }
    }
  }
}
console.log(apply ? '删了 ' + del + ' 个' : '只数不删：会删 ' + would + ' 个。要动就加 --apply')
