/**
 * 按"三档问法"分开报的检索评测
 * ==============================
 *
 * 为什么单独一个：eval-holdout 只报总命中率，看不出"正着问 / 绕着问 / 带错字问"
 * 哪一档是短板。标注集的核心就是这三档的差距。
 *
 * 跑法：node scripts/eval-labeled.mjs [sea] [集合路径]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const setPath = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : join(HERE, 'data', 'labeled-batch1.json')

// 2026-11-21：默认那份 labeled-batch1.json 在 11-15 那次误删里没了，直接读会吐一段栈。
// 现在缺了就说清缺哪份、目录里还有哪些，别拿别名的集子硬顶（形状不一样，分数会假）。
if (!existsSync(setPath)) {
  console.log('缺评测集：' + setPath)
  let others = []
  try {
    others = readdirSync(join(HERE, 'data')).filter((f) => /^labeled/i.test(f))
  } catch {}
  console.log(others.length ? '这个目录里现成的：' + others.join('、') : '这个目录里也没有别的 labeled 集子。')
  console.log('用法：node scripts/eval-labeled.mjs <海> <集子路径>')
  process.exit(2)
}
const set = JSON.parse(readFileSync(setPath, 'utf8').replace(/^\uFEFF/, ''))
const cases = (set.cases || []).filter((c) => c && c.q && c.want != null)
// 2026-11-21：集子形状不对（只有 q 没有 want）时题数是零，原来照样打印表头、退出码零——
// 外面看像「跑过了」。实测拿 labeled-batch.json 跑就是题 0。改成说清再退。
if (!cases.length) {
  console.log('这份集子里没有一条带 want 的题：' + setPath)
  console.log('一共 ' + String((set.cases || []).length) + ' 条 cases，形状可能跟这里要的不一样。')
  process.exit(2)
}
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const data = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

const t0 = Date.now()
const vecs = new Map()
for (const p of pts) vecs.set(p.id, await E.embedLocal(V.embedTextOf(p)))
const buildMs = Date.now() - t0

const tiers = new Map()
const misses = []
for (const c of cases) {
  const qv = await E.embedLocal(c.q)
  const ranked = pts
    .map((p) => ({ id: p.id, s: V.cosine(qv, vecs.get(p.id)) }))
    .sort((a, b) => b.s - a.s)
  const idx = ranked.findIndex((x) => Number(x.id) === Number(c.want))
  const tier = c.tier || '未分档'
  if (!tiers.has(tier)) tiers.set(tier, { n: 0, h1: 0, h3: 0 })
  const t = tiers.get(tier)
  t.n++
  if (idx === 0) t.h1++
  if (idx >= 0 && idx < 3) t.h3++
  if (idx !== 0) {
    misses.push({ q: c.q, want: c.want, at: idx < 0 ? '50+' : idx + 1, top: ranked[0] && ranked[0].id, tier })
  }
}

console.log(`海 ${sea} · 记忆 ${pts.length} · 题 ${cases.length} · 建向量 ${(buildMs / 1000).toFixed(1)}s`)
console.log('')
for (const [tier, t] of tiers) {
  console.log(`${tier}  题 ${t.n}   命中@1 ${t.h1}/${t.n} (${((t.h1 / t.n) * 100).toFixed(0)}%)   命中@3 ${t.h3}/${t.n} (${((t.h3 / t.n) * 100).toFixed(0)}%)`)
}
console.log('')
console.log('没进头名的（前 20）：')
for (const m of misses.slice(0, 20)) {
  console.log(`  [${m.tier}] ${m.q} → 想要 #${m.want}，排 ${m.at}，头名是 #${m.top}`)
}
