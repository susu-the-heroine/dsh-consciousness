/**
 * 向量文本拼法 A/B
 * ================
 *
 * 比四种拼法，看哪种在正向命中与反例误命中上最好：
 *   A 标题。别名。正文（现状，裁 400）
 *   B 加实体与分类：别名。标题。正文。实体：… 分类：…
 *   C 现状但正文放宽到 700
 *   D 只用正文（去掉标题，看标题是不是噪音）
 *
 * 跑法：node scripts/tune-vector.mjs [sea]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const TH = 0.55

const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

const sets = []
for (const f of ['recall-set-v2.json', 'recall-holdout.json']) {
  try {
    const s = JSON.parse(readFileSync(join(HERE, 'data', f), 'utf8').replace(/^\uFEFF/, ''))
    sets.push({ name: f.replace('.json', ''), cases: (s.cases || []).filter((c) => c && c.q) })
  } catch {}
}

const str = (x) => String(x || '').trim()
const ent = (p) => (Array.isArray(p.entities) ? p.entities.join('、') : str(p.entities))
const cat = (p) => (Array.isArray(p.category) ? p.category.join('、') : str(p.category))

const variants = {
  A_现状400: (p) => (str(p.alias) ? str(p.alias) + '。' : '') + str(p.title) + '。' + str(p.text).slice(0, 360),
  B_加实体分类: (p) => [str(p.alias), str(p.title), str(p.text).slice(0, 300), ent(p) && `涉及：${ent(p)}`, cat(p) && `属于：${cat(p)}`]
    .filter(Boolean).join('。').slice(0, 460),
  C_正文700: (p) => (str(p.alias) ? str(p.alias) + '。' : '') + str(p.title) + '。' + str(p.text).slice(0, 660),
  D_只用正文: (p) => (str(p.alias) ? str(p.alias) + '。' : '') + str(p.text).slice(0, 400),
}

for (const [vn, fn] of Object.entries(variants)) {
  const t0 = Date.now()
  const vecs = new Map()
  for (const p of pts) vecs.set(p.id, await E.embedLocal(fn(p)))
  const build = ((Date.now() - t0) / 1000).toFixed(0)
  const out = []
  for (const set of sets) {
    let pos = 0, h1 = 0, h3 = 0, h10 = 0
    const negTop = []
    for (const c of set.cases) {
      const qv = await E.embedLocal(c.q)
      const ranked = pts.map((p) => ({ id: p.id, s: V.cosine(qv, vecs.get(p.id)) })).sort((a, b) => b.s - a.s)
      if (c.want == null) { negTop.push(ranked[0].s); continue }
      pos++
      const i = ranked.findIndex((x) => x.id === c.want)
      if (i === 0) h1++
      if (i >= 0 && i < 3) h3++
      if (i >= 0 && i < 10) h10++
    }
    const over = negTop.filter((s) => s >= TH).length
    out.push(`${set.name}: @1 ${((h1 / (pos || 1)) * 100).toFixed(0)}% @3 ${((h3 / (pos || 1)) * 100).toFixed(0)}% @10 ${((h10 / (pos || 1)) * 100).toFixed(0)}%`
      + (negTop.length ? ` · 反例>${TH} ${over}/${negTop.length}` : ''))
  }
  console.log(`${vn}  (建向量 ${build}s)`)
  for (const line of out) console.log('   ' + line)
}
