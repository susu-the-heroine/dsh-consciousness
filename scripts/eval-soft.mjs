/**
 * 实验：命中必须"词真的出现过"，光靠向量像不算
 * ===============================================
 *
 * 做法：向量排完序之后，再过一道「共现」闸——
 *   问句里的两字词（中文按二元切，英文按词）有没有一条真的出现在这条记忆里
 *   （标题 / 正文 / 别名 / 实体 任一处出现即可）
 * 一条都不出现 → 这条被压分（乘 0.55），排名往后掉，但不能凭空消失。
 *
 * 对照跑：
 *   node scripts/eval-holdout.mjs     ← 原样
 *   node scripts/eval-cooc.mjs        ← 加共现闸
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = 'main'
const setPath = join(HERE, 'data', 'recall-holdout.json')
const TH = 0.55

const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const cases = set.cases.filter((c) => c && c.q)
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

// 只有这些字组成的二元组没有信息量，不算共现
const STOP = new Set(['什么', '怎么', '哪个', '哪些', '为什', '么会', '是不', '不是', '可以', '能不',
  '我们', '你们', '他们', '他的', '我的', '你的', '这个', '那个', '一个', '一次', '时候',
  '现在', '之前', '之后', '然后', '还是', '就是', '说的', '过的', '得要', '要不', '不能'])

function toks(s) {
  const out = new Set()
  const t = String(s || '')
  const cjk = t.match(/[\u4e00-\u9fa5]+/g) || []
  for (const seg of cjk) {
    for (let i = 0; i + 2 <= seg.length; i++) {
      const g = seg.slice(i, i + 2)
      if (!STOP.has(g)) out.add(g)
    }
  }
  const lat = t.toLowerCase().match(/[a-z0-9]{2,}/g) || []
  for (const w of lat) out.add(w)
  return out
}

const textOf = (p) => [
  p.title, p.text, p.alias, (p.entities || p.entity),
  Array.isArray(p.entity) ? p.entity.join(' ') : p.entity,
  Array.isArray(p.category) ? p.category.join(' ') : p.category,
].filter(Boolean).join(' ')

const t0 = Date.now()
const vecs = new Map()
const toksOf = new Map()
for (const p of pts) {
  vecs.set(p.id, await E.embedLocal(V.embedTextOf(p)))
  toksOf.set(p.id, toks(textOf(p)))
}
const buildMs = Date.now() - t0

let h1 = 0, h3 = 0, h10 = 0, pos = 0, dropped = 0
const negScores = []
const misses = []
for (const c of cases) {
  const qv = await E.embedLocal(c.q)
  const qt = toks(c.q)
  let ranked = pts
    .map((p) => ({ id: p.id, s: V.cosine(qv, vecs.get(p.id)) }))
    .sort((a, b) => b.s - a.s)
  // 软闸：没共现的不封杀，只压分（×0.55）；词真出现过的原样保留
  // 2026-11-21：跟 eval-rare 同一处毛病——拿排序前后条数差记被压分的个数，
  // 而 map 一条都不删，差永远是零，那行报告就一直写「合计 0 个」。改成压的那一刻自己数。
  ranked = ranked.map((x) => {
    const mt = toksOf.get(x.id)
    let hit = false
    for (const g of qt) if (mt.has(g)) { hit = true; break }
    if (hit) return x
    dropped++
    return { id: x.id, s: x.s * 0.55 }
  }).sort((a, b) => b.s - a.s)
  if (c.want == null) {
    negScores.push({ q: c.q, top: ranked.length ? ranked[0].s : 0, id: ranked.length ? ranked[0].id : 0 })
    continue
  }
  pos++
  const idx = ranked.findIndex((x) => x.id === c.want)
  if (idx === 0) h1++
  if (idx >= 0 && idx < 3) h3++
  if (idx >= 0 && idx < 10) h10++
  if (idx !== 0) misses.push({ q: c.q, want: c.want, at: idx < 0 ? '被闸挡了' : idx + 1 })
}

console.log(`软闸实验 · 记忆 ${pts.length} · 正向 ${pos} · 反例 ${negScores.length} · 建向量 ${(buildMs / 1000).toFixed(1)}s`)
console.log(`被压分的候选合计 ${dropped} 个`)
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
for (const m of misses.slice(0, 10)) console.log(`  ${m.q} → 想要 #${m.want}，${m.at}`)
