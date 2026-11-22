/**
 * 只存二字组的精度损失
 * ====================
 *
 *   node scripts/bench-gram-loss.mjs [题数]
 *
 * 大库为省内存只留二字组。这里量一刀：只按二字组挑候选，
 * 跟「二字组加三字组一起挑」比，差多少。
 *
 * 只读真库，不写任何东西。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { readSea } = await import(LIB + '/store.js')

const sea = 'main'
const data = readSea(sea)
const pts = (data && Array.isArray(data.points) ? data.points : []).filter((p) => p && !p.dead && !p.archived)
if (!pts.length) { console.log('主海是空的'); process.exit(0) }

const forms = (s, n) => {
  const x = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '')
  const out = new Set()
  for (let i = 0; i + n <= x.length; i++) out.add(x.slice(i, i + n))
  return out
}

const byId = new Map(pts.map((p) => [Number(p.id), p]))
// 2026-11-21：原来从条目自己的标题里剪问句，等于把答案喂进去，两边都满、量不出东西。
// 改用真留出集里的问法（别人嘴里的问法），带标准答案编号；没有再退回老办法并说明。
const { readFileSync: _rf, existsSync: _ex } = await import('node:fs')
const holdPath = join(HERE, 'data', 'recall-holdout.json')
let cases = []
if (_ex(holdPath)) {
  try {
    const j = JSON.parse(_rf(holdPath, 'utf8'))
    cases = (j.cases || []).filter((c) => c && c.q && c.want != null).map((c) => ({ q: String(c.q).slice(0, 24), want: Number(c.want) }))
  } catch { cases = [] }
}
if (!cases.length) {
  console.log('拿不到留出集，退回从条目自身截问句——那样两边都会接近满，别当数看。')
  cases = pts.slice(0, 40).map((p) => ({ q: String(p.title || p.text || '').slice(0, 24), want: Number(p.id) })).filter((x) => x.q.length >= 6)
}
const qs = cases.filter((x) => x.q.length >= 6)
if (!qs.length) { console.log('没抽到可用问句'); process.exit(0) }

let hit2 = 0
let hit3 = 0
let cand2 = 0
let cand3 = 0

for (const c of qs) {
  const q = c.q
  const q2 = forms(q, 2)
  const q3 = forms(q, 3)
  const expect = byId.get(Number(c.want))
  if (!expect) continue
  const wantId = Number(c.want)

  const score2 = (p) => {
    const g = forms(String(p.title || '') + String(p.text || ''), 2)
    let n = 0
    for (const x of q2) if (g.has(x)) n++
    return n
  }
  const score3 = (p) => {
    const g2 = forms(String(p.title || '') + String(p.text || ''), 2)
    const g3 = forms(String(p.title || '') + String(p.text || ''), 3)
    let n = 0
    for (const x of q2) if (g2.has(x)) n++
    for (const x of q3) if (g3.has(x)) n += 2
    return n
  }

  const r2 = pts.map((p) => [score2(p), Number(p.id)]).sort((a, b) => b[0] - a[0])
  const r3 = pts.map((p) => [score3(p), Number(p.id)]).sort((a, b) => b[0] - a[0])
  const c2 = r2.filter((x) => x[0] > 0).length
  const c3 = r3.filter((x) => x[0] > 0).length
  cand2 += c2
  cand3 += c3
  if (r2.slice(0, 10).some((x) => x[1] === wantId)) hit2++
  if (r3.slice(0, 10).some((x) => x[1] === wantId)) hit3++
  void byId
}

const n = qs.length
// 2026-11-21：问句来自留出集（别人嘴里的问法），这两行数才算「命中」，可以拿来比。
console.log(`抽 ${n} 问：只二字组 前十命中 ${hit2}/${n}（${Math.round((hit2 / n) * 100)}%）· 候选均 ${Math.round(cand2 / n)}`)
console.log(`           二字加三字 前十命中 ${hit3}/${n}（${Math.round((hit3 / n) * 100)}%）· 候选均 ${Math.round(cand3 / n)}`)
console.log(`差值：命中 ${hit2 - hit3 >= 0 ? '+' : ''}${hit2 - hit3} · 候选 ${cand2 - cand3 >= 0 ? '+' : ''}${cand2 - cand3}`)
process.exit(0)
