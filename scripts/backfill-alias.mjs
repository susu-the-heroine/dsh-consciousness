/**
 * 给一批记忆补别名（别人会怎么问）
 * ================================
 *
 * 别名会进向量（embedTextOf 已把它拼进去），所以补完要重算向量才生效。
 *
 * 跑法：node scripts/backfill-alias.mjs [sea] [别名json] [--apply]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const mapPath = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : join(HERE, 'data', 'aliases-backfill.json')
const apply = process.argv.includes('--apply')

const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const map = JSON.parse(readFileSync(mapPath, 'utf8').replace(/^\uFEFF/, ''))
const lock = S.lockSea(sea)
if (!lock.ok) { console.log('拿不到锁:', lock.err); process.exit(1) }
try {
  const data = S.readSea(sea)
  if (!data || !Array.isArray(data.points)) { console.log('没有这个海'); process.exit(1) }
  let changed = 0
  const report = []
  for (const [id, alias] of Object.entries(map)) {
    const p = data.points.find((x) => Number(x.id) === Number(id))
    if (!p) { report.push(`#${id} 不存在`); continue }
    if (String(p.alias || '').trim()) { report.push(`#${id} 已有别名，跳过`); continue }
    changed++
    if (apply) p.alias = String(alias)
    report.push(`#${id} ← ${alias}`)
  }
  if (apply && changed) S.writeSea(sea, data, lock)
  else S.unlockSea(lock)
  for (const r of report) console.log(' ', r)
  console.log('')
  console.log(apply ? `已写 ${changed} 条` : `干跑：要写 ${changed} 条（加 --apply 才真写）`)
} catch (e) {
  try { S.unlockSea(lock) } catch {}
  console.log('出错:', String((e && e.message) || e))
  process.exit(1)
}
