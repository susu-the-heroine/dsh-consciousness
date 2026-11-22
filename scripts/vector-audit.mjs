/**
 * 向量账本核对：有没有缺的、有没有过期的
 * ======================================
 *   node scripts/vector-audit.mjs [海名]
 *
 * 只看两件事，都是只读：
 *   1. 库里每条有效记忆，向量账本里有没有它
 *   2. 有是有的，但正文改过之后没重算（指纹对不上）——这叫过期向量，最坑：
 *      按语义搜它，搜出来的是旧内容的位置
 *
 * 不写库、不重算。要重算另跑 scripts/rebuild-vectors.mjs（那条会动真库，先备份）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] || 'main'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)

const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dataPath = join(dir, 'data.json')
const idxPath = join(dir, 'vectors.idx.json')
if (!existsSync(dataPath)) { console.error('找不到这个海：' + dataPath); process.exit(2) }

const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const live = (data.points || []).filter((p) => !p.dead && !p.archived)
const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : { ids: {} }
// 2026-11-21：原来只看正文指纹，换了模型但正文没动，它查不出来。
// 现在把账本记的模型/维度和当前代码里的模型比一比，对不上就明说。
let modelChanged = null
try {
  const VS = await import('file:///' + join(HERE, '..', 'lib', 'vecstore.js').replace(/\\/g, '/'))
  const curId = String(VS.MODEL_ID || '')
  const curDim = Number(VS.MODEL_DIM || 0)
  const oldId = String(idx.model || '')
  const oldDim = Number(idx.dim || 0)
  if (oldId && curId && oldId !== curId) modelChanged = '模型换了：账本是 ' + oldId + '，当前是 ' + curId
  else if (oldDim && curDim && oldDim !== curDim) modelChanged = '维度对不上：账本 ' + oldDim + '，当前 ' + curDim
} catch {}
const ids = idx.ids || {}

let missing = 0
let stale = 0
const missList = []
const staleList = []
for (const p of live) {
  const e = ids[String(p.id)]
  if (!e) { missing++; missList.push(p.id); continue }
  let want = ''
  try { want = V.textHash(V.embedTextOf(p)) } catch { continue }
  if (want && e.h && e.h !== want) { stale++; staleList.push(p.id) }
}

console.log(`海：${sea}`)
console.log(`有效记忆 ${live.length} 条｜账本 ${Object.keys(ids).length} 条｜模型 ${idx.model || '?'}｜维度 ${idx.dim || '?'}`)
console.log(`缺向量：${missing} 条${missList.length ? ' → ' + missList.slice(0, 20).join(',') : ''}`)
console.log(`过期向量（正文改过、向量没重算）：${stale} 条${staleList.length ? ' → ' + staleList.slice(0, 20).join(',') : ''}`)
if (modelChanged) {
  console.log('※ ' + modelChanged + ' —— 这种时候「缺向量」和「过期」都查不准，整库要重算。')
}
if (!missing && !stale && !modelChanged) console.log('账本干净：不用重算。')
// --strict：账本不干净就返回非零，给自检用
if (process.argv.includes('--strict') && (missing || stale || modelChanged)) process.exit(1)
