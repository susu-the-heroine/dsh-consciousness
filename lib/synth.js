/**
 * 合成：从两条记忆里长出第三条。
 *
 * 这一步不靠模板拼句子——模板拼出来的是废话。
 * 这里的活儿是"挑对子"：找出两条看上去不相干、但底下一个东西是通的记忆，
 * 交给会写字的那一层去写；写完作为新节点入库，标明是合成，不覆盖原件。
 * 2026-11-11 晚。
 */

const STOP_ENT = new Set(['我', '你', '他', '她', '它', '咱们', '我们'])

// 每个实体在库里出现多少条——用于剔"人人都有的那种词"。
// 不写死名字：谁的库谁自己算，甲库的高频词到乙库可能很稀有。2026-11-11。
function entityDf(alive) {
  const df = new Map()
  for (const p of alive) {
    for (const e of entsOf(p)) df.set(e, (df.get(e) || 0) + 1)
  }
  return df
}

function entsOf(p) {
  const raw = Array.isArray(p && p.entities) ? p.entities : []
  return raw.map((x) => String(x).trim()).filter((x) => x.length >= 2 && !STOP_ENT.has(x))
}

function textOf(p) {
  return String((p && p.title) || '') + ' ' + String((p && p.text) || '')
}

/** 两条之间"底下通着"的东西：共同实体 > 同标签不同类 > 都是高唤醒 */
function linkBetween(a, b, dfMap, total) {
  const ea = entsOf(a), eb = entsOf(b)
  // 高频实体（超过全库两成）不算线索，那只说明体裁相同，不是底下通着
  const cap = Math.max(3, Math.round((total || 1) * 0.2))
  const common = ea.filter((x) => eb.includes(x) && (dfMap.get(x) || 0) <= cap)
  if (common.length) return { kind: 'entity', on: common.slice(0, 2), w: 2.0 + common.length * 0.5 }

  const ta = Array.isArray(a.category) ? a.category : []
  const tb = Array.isArray(b.category) ? b.category : []
  const shareTag = ta.some((x) => tb.includes(x))
  const strong = (Number(a.arousal) || 0) >= 6 && (Number(b.arousal) || 0) >= 6
  if (shareTag && strong) return { kind: 'mood', on: ta.filter((x) => tb.includes(x)).slice(0, 2), w: 1.4 }
  if (strong) return { kind: 'strong', on: [], w: 1.0 }
  return null
}

/* 重复感：两条是不是在讲同一件事。
 * 老的算法只看前 40 字，配对"经十路×经十路"照样过。
 * 改用字的重合度（两字片段），再单独看标题——标题像的多半就是同一主题。
 * 2026-11-11。
 */
function bigrams(s) {
  const t = String(s || '').replace(/\s+/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

function overlap(a, b) {
  const A = bigrams(a), B = bigrams(b)
  if (!A.size || !B.size) return 0
  let same = 0
  for (const x of A) if (B.has(x)) same++
  return same / Math.min(A.size, B.size)
}

function tooSimilar(a, b, link) {
  const ta = textOf(a), tb = textOf(b)
  if (!ta.trim() || !tb.trim()) return true
  if (overlap(ta, tb) > 0.45) return true
  // 标题撞得厉害 = 同一主题，配了也是重复
  if (overlap(String(a.title || ''), String(b.title || '')) > 0.35) return true
  // 连接点同时出现在两个标题里 → 两条都在说同一个词，是同一件事
  // （"你骂我傻福" × "你嫌我傻福的那个下午"就是这样漏过去的）
  const la = String(a.title || ''), lb = String(b.title || '')
  for (const k of (link && link.on) || []) {
    if (la.includes(k) && lb.includes(k)) return true
  }
  return false
}

/**
 * 挑 N 对。
 * @param points 全部记忆
 * @param opt { n, minArousal, now }
 */
export function pickPairs(points, opt = {}) {
  const n = opt.n || 5
  const now = opt.now || Date.now()
  const alive = (Array.isArray(points) ? points : []).filter((p) => p && !p.dead && !p.archived)
  const dfMap = entityDf(alive)
  const total = alive.length
  const cand = []
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j]
      const link = linkBetween(a, b, dfMap, total)
      if (!link) continue
      if (tooSimilar(a, b, link)) continue
      // 两条都是很久以前写的，合成容易变考古；掺一条近一点的更好用
      const da = (now - (Number(a.born) || 0)) / 86400000
      const db = (now - (Number(b.born) || 0)) / 86400000
      const fresh = (da < 3 ? 1 : 0) + (db < 3 ? 1 : 0)
      const score = link.w * 10 + fresh * 3 + ((Number(a.imp) || 0) + (Number(b.imp) || 0)) * 4
      cand.push({ a, b, link, score })
    }
  }
  cand.sort((x, y) => y.score - x.score)
  // 一条记忆别参加太多对
  const used = new Set()
  // 同一个"接点"只用一次：四条里三条都在说路虎，等于只看到一件事。
  // 不认具体词，认"这条对子靠什么连起来的"。2026-11-11。
  const usedLink = new Set()
  const out = []
  for (const c of cand) {
    if (used.has(c.a.id) || used.has(c.b.id)) continue
    const linkKeys = (c.link.on && c.link.on.length ? c.link.on : [c.link.kind]).map(String)
    if (linkKeys.some((k) => usedLink.has(k))) continue
    for (const k of linkKeys) usedLink.add(k)
    used.add(c.a.id); used.add(c.b.id)
    out.push({
      a: { id: c.a.id, title: String(c.a.title || '').slice(0, 30), text: String(c.a.text || '').slice(0, 90) },
      b: { id: c.b.id, title: String(c.b.title || '').slice(0, 30), text: String(c.b.text || '').slice(0, 90) },
      why: c.link.kind + (c.link.on && c.link.on.length ? '：' + c.link.on.join('/') : ''),
      score: Math.round(c.score * 10) / 10,
    })
    if (out.length >= n) break
  }
  return out
}

/* ───── 每天攒一条候选 ─────
 * 每次点都换一组，等于每次都在抽签。改成一天内稳定：
 * 存一份到磁盘，24 小时内重复读同一份，过期再算。2026-11-11 晚。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_FILE = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-synth.json')
const CACHE_MS = 24 * 3600 * 1000

export function pickDaily(points, opt = {}) {
  const n = opt.n || 6
  const now = opt.now || Date.now()
  try {
    if (existsSync(CACHE_FILE)) {
      const j = JSON.parse(readFileSync(CACHE_FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
      const fresh = (now - (Number(j.at) || 0)) < CACHE_MS
      const sameN = Number(j.n) === n
      const haveIds = Array.isArray(j.pairs) && j.pairs.length
      if (fresh && sameN && haveIds) {
        // 缓存里提到的点必须还活着，否则重新算
        const alive = new Set((points || []).filter((p) => p && !p.dead && !p.archived).map((p) => p.id))
        const ok = j.pairs.every((x) => alive.has(x.a.id) && alive.has(x.b.id))
        if (ok) return j.pairs
      }
    }
  } catch {}
  const pairs = pickPairs(points, { n, now })
  try { writeFileSync(CACHE_FILE, JSON.stringify({ at: now, n, pairs }), 'utf8') } catch {}
  return pairs
}
