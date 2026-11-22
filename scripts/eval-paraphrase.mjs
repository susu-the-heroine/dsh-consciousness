/**
 * 验"误伤"：换了说法的正常查询，开闸和不开闸各命中多少
 * 跑法：node scripts/eval-paraphrase.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 2026-11-21：这份标注集在 11-15 凌晨那次误删里没了（同 eval-intent 记过的同一件事）。
// 原来直接读，缺了就吐一段栈——看不出是「数据缺」还是「代码错」。现在说清再退。
const setPath = join(HERE, 'data', 'paraphrase-set.json')
if (!existsSync(setPath)) {
  console.log('缺标注集：' + setPath)
  console.log('做法：用真实问法重新标，按 { cases: [{ q, want }] } 存回去。别猜、别凭记忆重造。')
  process.exit(2)
}
const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())
const { classifyIntent } = await import('file:///' + join(HERE, '..', 'lib', 'intent.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', 'main')
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.validUntil)

const tk = (s0) => {
  const out = new Set()
  const tt = String(s0 || '')
  for (const seg of (tt.match(/[\u4e00-\u9fa5]+/g) || [])) for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2))
  for (const w of (tt.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w)
  return out
}
const txt = (p) => [p.title, p.text, p.alias, (p.entities || p.entity)].filter(Boolean).join(' ')
const df = new Map()
const toks = new Map()
for (const p of pts) { const st = tk(txt(p)); toks.set(p.id, st); for (const g of st) df.set(g, (df.get(g) || 0) + 1) }
const rareMax = Math.max(3, Math.round(pts.length * 0.05))
const LOG = /成了|跑通|定了|记一|踩坑|实测|修好|搬上|接进|上线/

const vecs = new Map()
for (const p of pts) vecs.set(p.id, await E.embedLocal(V.embedTextOf(p)))

let raw3 = 0, gate3 = 0, raw1 = 0, gate1 = 0
const hurt = []
for (const c of set.cases) {
  const qv = await E.embedLocal(c.q)
  const q = tk(c.q)
  const ranked = pts.map((p) => ({ id: p.id, s: V.cosine(qv, vecs.get(p.id)) })).sort((a, b) => b.s - a.s)
  const gi = ranked.findIndex((x) => x.id === c.want)
  if (gi === 0) raw1++
  if (gi >= 0 && gi < 3) raw3++

  const isOp = classifyIntent(c.q) === 'op'
  const gated = ranked.map((x) => {
    const mt = toks.get(x.id)
    let hit = false
    for (const g of q) if (mt.has(g) && (df.get(g) || 0) <= rareMax) { hit = true; break }
    // 语义分够高（>=0.62）就豁免：换说法但意思很近的，不该被词表拖死
    let s2 = hit || x.s >= 0.62 ? x.s : x.s * 0.55
    if (isOp) { const p2 = pts.find((z) => z.id === x.id); if (p2 && LOG.test(String(p2.title || ''))) s2 *= 0.5 }
    return { id: x.id, s: s2 }
  }).sort((a, b) => b.s - a.s)
  const gg = gated.findIndex((x) => x.id === c.want)
  if (gg === 0) gate1++
  if (gg >= 0 && gg < 3) gate3++
  if (gi >= 0 && gi < 3 && !(gg >= 0 && gg < 3)) hurt.push({ q: c.q, before: gi + 1, after: gg < 0 ? '掉出榜' : gg + 1 })
}

const n = set.cases.length
console.log('换说法验伤 · ' + n + ' 条')
console.log('  不开闸：头名 ' + raw1 + '/' + n + '，前三 ' + raw3 + '/' + n)
console.log('  开闸后：头名 ' + gate1 + '/' + n + '，前三 ' + gate3 + '/' + n)
console.log('')
if (hurt.length) { console.log('被压出去的 ' + hurt.length + ' 条：'); for (const h of hurt) console.log('  ' + h.q + ' → 原来第 ' + h.before + '，现在 ' + h.after) }
else console.log('没有一条被压出前三。')
