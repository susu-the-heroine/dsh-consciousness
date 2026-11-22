/**
 * 把候选别名并进海（要人点头才跑）
 * ================================
 *
 *   node scripts/alias-apply.mjs [--sea=main] [--dry]
 *
 * 只做一件事：把 alias-candidates-auto.json 里那些候选，按 point 追进别名数组。
 * 写前备份到 ~/.dsh/consciousness-backups/，写后读回来核一遍。
 * 不自动模糊并、不新建条目——候选必须已经指向现成那条。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonAtomic, readJsonSafe } from '../lib/json-file.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.USERPROFILE || homedir()
const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const dry = process.argv.includes('--dry')

const dataPath = join(HOME, '.dsh', 'consciousness-seas', sea, 'data.json')
const candPath = join(HERE, 'data', 'alias-candidates-auto.json')
const data = readJsonSafe(dataPath, null)
if (!data) throw new Error('读不到 ' + dataPath)
const cands = JSON.parse(readFileSync(candPath, 'utf8')).candidates || []
const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))

const planned = []
for (const c of cands) {
  const p = byId.get(Number(c.point))
  if (!p) continue
  // 2026-11-21：这里原来把别名当数组。可真库里 alias 是字符串，整条链路都用 String(alias) 读。
  // 实测：临时库里原有 alias「原来的叫法」，跑一遍变成只剩新短语的数组——形状变了，原来的叫法也没了。
  const cur = String(p.alias || '').trim()
  if (cur.includes(c.phrase)) continue
  planned.push({ id: Number(c.point), phrase: c.phrase, title: String(p.title || '').slice(0, 30) })
}

if (!planned.length) {
  console.log('没有要并的（候选都已存在）')
  process.exit(0)
}
console.log(`准备并 ${planned.length} 条：`)
for (const x of planned) console.log(`  #${x.id} ← 「${x.phrase}」`)

if (dry) {
  console.log('（--dry，不写）')
  process.exit(0)
}

// 备份
const bakDir = join(HOME, '.dsh', 'consciousness-backups')
mkdirSync(bakDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const bak = join(bakDir, `${sea}-aliases-${stamp}.json`)
writeFileSync(bak, JSON.stringify(data), 'utf8')
console.log('备份：' + bak)

for (const x of planned) {
  const p = byId.get(x.id)
  const cur = String(p.alias || '').trim()
  p.alias = cur ? cur + '、' + x.phrase : x.phrase
}
writeJsonAtomic(dataPath, data)

// 别名只写了 JSON，镜像会落后——当场重写镜像，别留着让 parity 变红
try {
  const { replaceAll } = await import('../lib/sqlite-mirror.js')
  replaceAll(sea, (data.points || []).filter((p) => !p.dead))
  console.log('镜像已同步')
} catch (e) {
  console.log('镜像同步失败（不影响 JSON）：' + (e && e.message))
}

// 读回核对
const back = readJsonSafe(dataPath, null)
let ok = 0
for (const x of planned) {
  const p = (back.points || []).find((q) => Number(q.id) === x.id)
  if (p && String(p.alias || '').includes(x.phrase)) ok++
}
console.log(`写回核对：${ok}/${planned.length} 条已在库里`)
console.log(`主海条数：${(back.points || []).filter((p) => !p.dead).length}`)
if (ok !== planned.length) process.exit(1)
