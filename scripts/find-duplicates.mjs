/**
 * 查重：找出"同一件事被记了两遍"
 * ==============================
 *
 * 2026-11-12：评测里七道"排错"有五道是重复条目——两条讲同一件事，判据只认一条 id，
 * 另一条排第一就判错。这不是排序问题，是库里重复。用户看到两条并排也会觉得敷衍。
 *
 * 只出候选，不合并。合并要人点头。
 *
 * 跑法：node scripts/find-duplicates.mjs [sea] [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
let vecs = {}
try { vecs = JSON.parse(readFileSync(join(dir, 'vectors.json'), 'utf8').replace(/^\uFEFF/, '')) } catch {}

const vOf = (p) => {
  const r = vecs[String(p.id)]
  return r ? (Array.isArray(r) ? r : r.v) : null
}
const norm = (s) => String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-]/g, '')

const pairs = []
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j]
    const va = vOf(a), vb = vOf(b)
    const cos = (va && vb) ? V.cosine(va, vb) : 0
    const ta = norm(a.title), tb = norm(b.title)
    const titleSame = ta && tb && (ta === tb || ta.includes(tb) || tb.includes(ta))
    const textSim = (() => {
      const A = norm(a.text).slice(0, 120), B = norm(b.text).slice(0, 120)
      if (!A || !B) return 0
      let n = 0
      for (let k = 0; k + 3 <= A.length; k += 3) if (B.includes(A.slice(k, k + 3))) n++
      return n / Math.max(1, Math.floor(A.length / 3))
    })()
    // 判重：语义很像（>=0.90）且正文开头高度重合，或者标题基本一样且语义 >=0.85
    if ((cos >= 0.90 && textSim >= 0.45) || (titleSame && cos >= 0.85) || textSim >= 0.8) {
      pairs.push({ a: a.id, b: b.id, ta: String(a.title).slice(0, 24), tb: String(b.title).slice(0, 24), cos: Number(cos.toFixed(3)), textSim: Number(textSim.toFixed(2)) })
    }
  }
}
pairs.sort((x, y) => y.cos - x.cos)
console.log(`海 ${sea} · ${pts.length} 条 · 查到重复候选 ${pairs.length} 对`)
for (const p of pairs.slice(0, 20)) console.log(`  #${p.a} ${p.ta}  ≈  #${p.b} ${p.tb}   cos ${p.cos} 文本 ${p.textSim}`)
const out = join(HERE, 'data', `duplicates-${sea}.json`)
writeFileSync(out, JSON.stringify(pairs, null, 1), 'utf8')
console.log('')
console.log('已存:', out, '（只出候选，不合并）')
