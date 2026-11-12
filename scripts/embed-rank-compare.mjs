/**
 * 排序对照：本地 ONNX 向量 vs 模型版向量
 * ====================================
 *
 * 同一批问句，同一批记忆，各排前三：看名次丢没丢人。
 * 只读真库，不写任何文件。
 *
 * 跑法：node scripts/embed-rank-compare.mjs [sea] [问句向量.json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] || 'main'
const qfile = process.argv[3] || join(tmpdir(), 'bge-qvecs.json')
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const points = (data.points || []).filter((p) => !p.dead)
const raw = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8').replace(/^\uFEFF/, ''))
const vecOf = (r) => (Array.isArray(r) ? r : (r && Array.isArray(r.v) ? r.v : []))
if (!existsSync(qfile)) { console.log('没有问句向量：' + qfile); process.exit(1) }
const qref = JSON.parse(readFileSync(qfile, 'utf8'))

const cos = (a, b) => {
  if (!a || !b || !a.length || a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

console.log('本地算全库向量…')
const t0 = Date.now()
const local = {}
for (const p of points) {
  local[String(p.id)] = await E.embedLocal(String(p.title || '') + ' ' + String(p.text || ''))
}
console.log(`算完 ${points.length} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)

const top3 = (get) => points
  .map((p) => ({ id: p.id, s: cos(get(p), null) }))
  .sort((a, b) => b.s - a.s)
  .slice(0, 3)

let same = 0
let n = 0
console.log('')
console.log('问句'.padEnd(22), '模型版前三'.padEnd(20), '本地前三'.padEnd(20), '一样?')
for (const [q, want] of Object.entries(qref)) {
  n++
  const lq = await E.embedLocal(q)
  const a = points.map((p) => ({ id: p.id, s: cos(want, vecOf(raw[String(p.id)])) })).sort((x, y) => y.s - x.s).slice(0, 3)
  const b = points.map((p) => ({ id: p.id, s: cos(lq, local[String(p.id)]) })).sort((x, y) => y.s - x.s).slice(0, 3)
  const sameSet = a.map((x) => x.id).join(',') === b.map((x) => x.id).join(',')
  const sameTop = a[0].id === b[0].id
  if (sameSet) same++
  console.log(
    q.padEnd(22),
    a.map((x) => '#' + x.id).join(',').padEnd(18),
    b.map((x) => '#' + x.id).join(',').padEnd(18),
    sameSet ? (sameTop ? '一样' : '同集合') : '不同',
  )
}
console.log('')
console.log(`前三集合一致 ${same}/${n}`)
