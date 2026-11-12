/**
 * 检索评测 v2：正向 + 反例
 * ========================
 *
 * 正向：算命中@1/@3/@10。
 * 反例：库里没有的东西，理想情况不该给出高分。记「最高分」和「超过阈值的条数」。
 *
 * 跑法：node scripts/eval-recall2.mjs [sea] [评测集路径] [--alias]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const setPath = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : join(HERE, 'data', 'recall-set-v2.json')
const useAlias = process.argv.includes('--alias')
const TH = 0.55

const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const cases = set.cases.filter((c) => c && c.q)
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

// 向量文本：默认 标题+正文；--alias 时把别名也拼进去（做 A/B 用）
const noAlias = process.argv.includes('--no-alias')
const textOf = (p) => {
  if (noAlias) return (String(p.title || '') + '。' + String(p.text || '')).slice(0, 400)
  return V.embedTextOf(p)   // 已含别名
}

const t0 = Date.now()
const vecs = new Map()
for (const p of pts) vecs.set(p.id, await E.embedLocal(textOf(p)))
const buildMs = Date.now() - t0

let h1 = 0, h3 = 0, h10 = 0, pos = 0
const negScores = []
const misses = []
for (const c of cases) {
  const qv = await E.embedLocal(c.q)
  const ranked = pts
    .map((p) => ({ id: p.id, s: V.cosine(qv, vecs.get(p.id)) }))
    .sort((a, b) => b.s - a.s)
  if (c.want == null) {
    negScores.push({ q: c.q, top: ranked[0].s, id: ranked[0].id })
    continue
  }
  pos++
  const idx = ranked.findIndex((x) => x.id === c.want)
  if (idx === 0) h1++
  if (idx >= 0 && idx < 3) h3++
  if (idx >= 0 && idx < 10) h10++
  if (idx !== 0) misses.push({ q: c.q, want: c.want, at: idx < 0 ? '50+' : idx + 1 })
}

console.log(`海 ${sea} · 记忆 ${pts.length} · 正向 ${pos} · 反例 ${negScores.length} · 建向量 ${(buildMs / 1000).toFixed(1)}s`)
console.log(`%s`, useAlias ? '（向量含别名）' : '（向量只用标题+正文）')
console.log('')
console.log(`命中@1  ${h1}/${pos}  (${((h1 / pos) * 100).toFixed(0)}%)`)
console.log(`命中@3  ${h3}/${pos}  (${((h3 / pos) * 100).toFixed(0)}%)`)
console.log(`命中@10 ${h10}/${pos}  (${((h10 / pos) * 100).toFixed(0)}%)`)
const over = negScores.filter((x) => x.top >= TH)
const avg = negScores.reduce((s, x) => s + x.top, 0) / (negScores.length || 1)
console.log('')
console.log(`反例：平均最高分 ${avg.toFixed(3)} · 超过 ${TH} 的 ${over.length}/${negScores.length}`)
for (const x of over.slice(0, 6)) console.log(`  误命中 ${x.top.toFixed(3)} #${x.id} ← ${x.q}`)
console.log('')
console.log('没进头名的：')
for (const m of misses.slice(0, 10)) console.log(`  ${m.q} → 想要 #${m.want}，排 ${m.at}`)
