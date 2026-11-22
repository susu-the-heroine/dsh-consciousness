/**
 * 离线回头看：没人问的时候，自己翻一遍库
 * ======================================
 *
 * 为什么要有（用户反馈第四条）：记忆只在被问的时候被动检索。
 * 于是同一件事反复记成新条、互相矛盾的两条并存、该沉的一直占着位置。
 *
 * 这一版只做三件，且只读不写：
 *   一、重复：两条说的是同一件事（二元词重合 + 日期不同）
 *   二、矛盾：同一个事实键有多条，或标题极像但情绪极性相反
 *   三、久未想起：六十天没被想起、且不是规矩／钉子／约定
 *
 * 跑法：
 *   node scripts/review.mjs            干跑，只报候选
 *   node scripts/review.mjs --sea test_cycle
 *
 * 下一步（还没做）：挑出来的候选交给模型裁决，裁决结果写回一条记忆。
 * 不先上模型，是因为整库丢给模型既慢又不稳，规则筛完通常只剩十来条。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sea = process.argv.includes('--sea')
  ? process.argv[process.argv.indexOf('--sea') + 1]
  : 'main'

const FILE = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(FILE)) {
  console.log('没有这个海：' + sea)
  process.exit(1)
}
const data = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
console.log('')
console.log('回头看 · 海 ' + sea + ' · ' + pts.length + ' 条在册')
console.log('──────────────────────────────────────────────')

// ── 工具
const DAY = 86400000
function grams(s, n = 2) {
  const out = new Set()
  const t = String(s || '').toLowerCase()
  for (const seg of (t.match(/[\u4e00-\u9fa5]+/g) || [])) {
    for (let i = 0; i + n <= seg.length; i++) out.add(seg.slice(i, i + n))
  }
  for (const w of (t.match(/[a-z0-9]{2,}/g) || [])) out.add(w)
  return out
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0
  let n = 0
  for (const g of a) if (b.has(g)) n++
  return n / Math.min(a.size, b.size)
}

// 2026-11-21：并集口径。上面那个取的是两边较小的那片，短标题只要被长标题包含就算一比一——
// 实测「腰疼」和「他说腰疼得站不起来那天」被判成「标题几乎一样」，其实只是碰了两个字。
// 判「几乎一模一样」得用并集，两边都得占满。
function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let n = 0
  for (const g of a) if (b.has(g)) n++
  return n / (a.size + b.size - n)
}
function tsOf(p) {
  const v = p.lastSeen || p.addedAt || p.createdAt || p.born || 0
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? Date.parse(m[1] + '-' + m[2] + '-' + m[3]) : 0
}

// ── 一、重复
const gs = new Map()
for (const p of pts) gs.set(p.id, grams(String(p.title || '') + ' ' + String(p.text || '')))
const dupes = []
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i]
    const b = pts[j]
    const s = overlap(gs.get(a.id), gs.get(b.id))
    if (s < 0.55) continue
    const ta = tsOf(a)
    const tb = tsOf(b)
    if (ta && tb && Math.abs(ta - tb) < DAY) continue      // 同一天写的多半是同一条被拆了
    dupes.push({ s, a, b })
  }
}
dupes.sort((x, y) => y.s - x.s)
console.log('')
console.log('一、可能是同一件事（' + dupes.length + ' 对，看前 6）')
for (const d of dupes.slice(0, 6)) {
  console.log('  ' + d.s.toFixed(2) + '  #' + d.a.id + ' ' + String(d.a.title).slice(0, 18)
    + '   ⟷   #' + d.b.id + ' ' + String(d.b.title).slice(0, 18))
}

// ── 一之二、按语义找重复（向量已经有了，别浪费）
//    字面判据在真库上一条都挑不出来，因为措辞差得远；
//    向量能看出"说的其实是同一件事"。
let vecDupes = []
try {
  const VF = join(homedir(), '.dsh', 'consciousness-seas', sea, 'vectors.json')
  if (existsSync(VF)) {
    const vj = JSON.parse(readFileSync(VF, 'utf8').replace(/^\uFEFF/, ''))
    const ids = []
    for (const p of pts) if (vj[String(p.id)] && Array.isArray(vj[String(p.id)].v)) ids.push(p)
    const cos = (a, b) => {
      let s = 0
      for (let i = 0; i < a.length; i++) s += a[i] * b[i]
      return s
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        const va = vj[String(a.id)]
        const vb = vj[String(b.id)]
        if (va.fp === vb.fp) continue          // 同一份文本，不用看
        const s = cos(va.v, vb.v)
        if (s >= 0.86) vecDupes.push({ s, a, b })
      }
    }
    vecDupes.sort((x, y) => y.s - x.s)
  }
} catch {}
console.log('')
console.log('一之二、按语义像同一件事（' + vecDupes.length + ' 对，看前 6）')
for (const d of vecDupes.slice(0, 6)) {
  console.log('  ' + d.s.toFixed(3) + '  #' + d.a.id + ' ' + String(d.a.title).slice(0, 16)
    + '   ⟷   #' + d.b.id + ' ' + String(d.b.title).slice(0, 16))
}

// ── 二、矛盾
const byKey = new Map()
for (const p of pts) {
  const k = String(p.factKey || '').trim()
  if (!k) continue
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(p)
}
const conflicts = []
for (const [k, list] of byKey) {
  if (list.length < 2) continue
  const live = list.filter((p) => !p.validUntil)
  if (live.length >= 2) conflicts.push({ why: '同一事实键多条同时有效', k, list: live })
}
// 标题极像、极性相反
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i]
    const b = pts[j]
    if (a.factKey || b.factKey) continue
    const ta = String(a.title || '')
    const tb = String(b.title || '')
    if (!ta || !tb) continue
    // 收窄（2026-11-14 第一次跑出来的教训）：
    // 光"标题像 + 情绪相反"会把「你的那句爱你」和「我欠你的那句去躺平」判成矛盾——
    // 它们只是都带"你的那句"。要求标题几乎一模一样（0.85）才算撞车。
    if (jaccard(grams(ta), grams(tb)) < 0.85) continue
    const pa = Number(a.polarity)
    const pb = Number(b.polarity)
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa * pb < 0) {
      conflicts.push({ why: '标题几乎一样、情绪相反', list: [a, b] })
    }
  }
}
console.log('')
console.log('二、可能互相矛盾（' + conflicts.length + ' 组，看前 6）')
for (const c of conflicts.slice(0, 6)) {
  console.log('  [' + c.why + ']')
  for (const p of c.list.slice(0, 3)) {
    console.log('     #' + p.id + ' ' + String(p.title).slice(0, 30)
      + '（极性 ' + (p.polarity ?? '未标') + '）')
  }
}

// ── 三、久未想起
const now = Date.now()
const stale = pts.filter((p) => {
  if (p.rule === true) return false
  if (String(p.kind || '') === 'taboo') return false
  if (p.factKey) return false
  const t = tsOf(p)
  if (!t) return false
  if (now - t < 60 * DAY) return false
  const rc = Number(p.recallCount || 0)
  return rc <= 2
}).sort((a, b) => tsOf(a) - tsOf(b))
console.log('')
console.log('三、六十天没被想起、且几乎没被提过（' + stale.length + ' 条，看前 6）')
for (const p of stale.slice(0, 6)) {
  const d = new Date(tsOf(p))
  console.log('  #' + p.id + ' ' + (d.getMonth() + 1) + '月' + d.getDate() + '日  '
    + String(p.title).slice(0, 30) + '（想起 ' + (p.recallCount || 0) + ' 次）')
}

// ── 收尾
console.log('')
console.log('──────────────────────────────────────────────')
console.log('合计：重复 ' + dupes.length + ' 对 · 矛盾 ' + conflicts.length + ' 组 · 该沉 ' + stale.length + ' 条')
console.log('这一版只报不改。真要动，下一步是让模型裁决，再把结论写成一条记忆。')
