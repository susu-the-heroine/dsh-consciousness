/**
 * 把缺的向量补齐（命令行版）
 * ========================
 *
 *   node scripts/embed-backfill.mjs [识海] [--dry]
 *
 * 真正的实现在 `lib/vectors.js` 的 `syncVectors(sea, data, limit)`：
 * 它既补"没有的"，也补"文本改过、指纹对不上的"。这个脚本只是把它循环叫到补完为止，
 * 不另写一份逻辑——两份实现迟早会分叉（今晚刚为这个删过一份）。
 *
 * 只动 `vectors.json`，不碰 data.json。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 2026-11-21：原来直接拿第二个参数当海名，`--dry` 打头的用法会被当成海名——
// 实测 `node scripts/embed-backfill.mjs --dry` 报「没有这个识海：--dry」。
// 别的脚本都是先剔掉带横杠的参数，这里跟上。
const pos = process.argv.slice(2).filter((x) => !x.startsWith('--'))
const sea = (pos[0] || 'sandbox').trim() || 'sandbox'
const dry = process.argv.includes('--dry')

const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/'))
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const dataPath = join(dir, 'data.json')
if (!existsSync(dataPath)) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}

const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
const alive = (data.points || []).filter((p) => !p.dead && !p.archived && !p.validUntil)

// 只认"形状对"的：syncVectors 写的是 { v: [...], h, at }。
// 早先有人（我）直接写过裸数组，那种虽然"有"，但缺指纹，文本一改就永远不更新——
// 统计时必须算成"缺"，才会被重算成正常形状。
function coverage() {
  let vecs = {}
  try { vecs = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8')) || {} } catch { vecs = {} }
  return alive.filter((p) => {
    const cur = vecs[String(p.id)]
    return !cur || !Array.isArray(cur.v) || !cur.v.length
  }).length
}

const before = coverage()
console.log(`海 ${sea}：活 ${alive.length} · 缺向量 ${before}${dry ? '（只看不写）' : ''}`)
if (!before || dry) process.exit(0)

let total = 0
for (let round = 0; round < 200; round++) {
  const n = await V.syncVectors(sea, data, 50)
  if (!n) break
  total += n
  if (coverage() === 0) break
}

const after = coverage()
console.log(`补了 ${total} 条 · 还缺 ${after}`)
process.exit(after === 0 ? 0 : 1)
