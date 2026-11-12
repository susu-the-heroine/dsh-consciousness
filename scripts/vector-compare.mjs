/**
 * 向量层公平对照：模型版（bge） vs 纯 JS 版
 * ==========================================
 *
 * 问句向量由模型那边单独算好（临时文件），这里只做"同一批问句、两套库内向量"的排序对比。
 * 不动真库、不写任何文件。
 *
 * 跑法：node scripts/vector-compare.mjs [sea] [问句向量.json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] || 'main'
const qfile = process.argv[3] || join(tmpdir(), 'bge-qvecs.json')
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const points = (data.points || []).filter((p) => !p.dead)
const oldVecs = existsSync(join(dir, 'vectors.json'))
  ? JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8').replace(/^\uFEFF/, ''))
  : null
if (!oldVecs) { console.log('这个海没有模型版向量'); process.exit(1) }
if (!existsSync(qfile)) { console.log('没有问句向量文件：' + qfile); process.exit(1) }
const qvecs = JSON.parse(readFileSync(qfile, 'utf8'))

const newVecs = E.buildVectorsFor(points)

const CASES = [
  { q: '跟外人说话该说多细', want: 150 },
  { q: '那个暗号叫啥来着', want: 153 },
  { q: '以前记下的事能不能当准', want: 176 },
  { q: '你名字到底谁起的', want: 1 },
  { q: '你说的东西咋跟汇报似的', want: 122 },
  { q: '烟和酒你啥态度', want: 4 },
  { q: '上下文满了那次你写了啥', want: 118 },
  { q: '我咋老在同一个地方摔', want: 172 },
  { q: '一个人能不能代表所有人', want: 156 },
  { q: '拍视频摔了三次那段', want: null },
]

// 老向量每条是 {fp,h,at,v}，要取 .v；新向量是纯数组
const vecOf = (rec) => (Array.isArray(rec) ? rec : (rec && Array.isArray(rec.v) ? rec.v : []))
const top3 = (vecs, v) => points
  .map((p) => ({ id: p.id, s: E.cosine(v, vecOf(vecs[String(p.id)])) }))
  .sort((a, b) => b.s - a.s)
  .slice(0, 3)

let n = 0
let oldHit = 0
let newHit = 0
console.log('问句'.padEnd(22), '期望', '| bge 前三'.padEnd(18), '| 纯 JS 前三'.padEnd(18))
for (const c of CASES) {
  const q = qvecs[c.q]
  if (!q) continue
  n++
  const ro = top3(oldVecs, q)
  const rn = top3(newVecs, E.embed(c.q))
  const okO = c.want ? ro.some((x) => x.id === c.want) : null
  const okN = c.want ? rn.some((x) => x.id === c.want) : null
  if (okO) oldHit++
  if (okN) newHit++
  console.log(
    c.q.padEnd(22),
    String(c.want ?? '-').padEnd(4),
    '|',
    ro.map((x) => `#${x.id}(${x.s.toFixed(2)})`).join(' ').padEnd(16),
    '|',
    rn.map((x) => `#${x.id}(${x.s.toFixed(2)})`).join(' ').padEnd(16),
    c.want ? (okN ? '新✓' : '新✗') : '',
  )
}
console.log('')
console.log(`bge 前三命中 ${oldHit}/${n} · 纯 JS 前三命中 ${newHit}/${n}`)
