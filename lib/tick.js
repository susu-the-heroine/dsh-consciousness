/**
 * 后台步进（第一二层）
 * ===================
 *
 * 每 20 分钟跑一次，不需要模型：
 *   一、情绪往她自己的底色回落（不是回"中性"）
 *   二、按当前情绪加权抽一条记忆——"被勾住"
 *   三、同一条两小时内被勾三次 → 记成一条"待成文"的线索
 *
 * **刻意不写"她的话"**：没有模型就不编。L3 有模型时，把那条线索变成一句话。
 * 宁可让内观页显示"正被勾着的一条"，也不拿模板冒充她想出来的东西。
 */
import { readSea } from './store.js'
import { readHeart, writeHeart, tickHeart, defaultMood } from './mood.js'
import { project, DIM_KEYS } from './emotion-lexicon.js'
import { recordDims } from './moodline.js'
import { towardBaseline } from './dynamics.js'
import { listThoughts, addThought } from './selfmind.js'
import { audit } from './log.js'

/** 她自己的底色：偏静、偏寥寂、带一点点恻隐 */
export const BASELINE = project({ v: -0.12, a: 0.10, d: -0.08 })

/** 两小时内同一条被勾三次，才算"真的被勾住" */
export const DRAW_WINDOW_MS = 2 * 3600 * 1000
export const DRAW_THRESHOLD = 2

/** 记一次"被勾住"。返回被勾的记忆 */
export function noteDrawn(heart, point, now) {
  const t = Number(now) || Date.now()
  if (!heart || !point) return null
  const prev = heart.beingDrawn && Number(heart.beingDrawn.id) === Number(point.id)
    && t - Number(heart.beingDrawn.since || 0) < DRAW_WINDOW_MS
  const since = prev ? Number(heart.beingDrawn.since) : t
  const times = prev ? (Number(heart.beingDrawn.times) || 1) + 1 : 1
  heart.beingDrawn = {
    id: Number(point.id),
    title: String(point.title || '').slice(0, 40),
    since,
    times,
    at: t,
  }
  return heart.beingDrawn
}

/**
 * 抽一条"被勾住"的记忆。
 *
 * 不是纯随机：情绪越接近、越久没被想起，越容易被抽中。
 * 情绪用 affinity 那一套的简化版：同号加权重，强度近再加。
 */
export function pickDrawn(points, dims, rand, prev) {
  const r = rand || Math.random
  const list = (points || []).filter((p) => p && !p.dead)
  if (!list.length) return null

  // 人心里挂着的那件事会**反复浮现**，不是每 20 分钟换一条。
  // 纯随机 131 条里抽三次同一条，概率接近零——"连勾三次"永远不会发生，
  // 所以这里必须有黏着：接着想刚才那条的概率接近一半。
  if (prev && prev.id) {
    const stay = Number(prev.stayProb)
    const p = Number.isFinite(stay) ? stay : 0.45
    if (r() < p) {
      const again = list.find((x) => Number(x.id) === Number(prev.id))
      if (again) return again
    }
  }

  const lonely = Number(dims && dims.lonely) || 0
  const weary = Number(dims && dims.weary) || 0
  const tender = Number(dims && dims.tender) || 0
  const sunk = lonely + weary * 0.6
  const soft = tender

  const weights = []
  let total = 0
  for (const p of list) {
    const pol = Number(p.polarity) || 0
    const aro = Number(p.arousal) || 0
    // 下沉时更爱想起负的、强度高的；柔的时候更爱想起正的
    let w = 1
    if (sunk > 0.18 && pol < 0) w += sunk * 2.2
    if (soft > 0.18 && pol > 0) w += soft * 1.6
    if (aro > 6) w += 0.25
    // 越久没被想起，权重略高（但不过度）
    const last = Number(p.lastSeen) || 0
    if (last) {
      const days = Math.max(0, (Date.now() - last) / 86400000)
      w += Math.min(0.6, days / 30)
    }
    // 极重要的稍微优先
    w += (Number(p.imp) || 0) * 0.3
    weights.push(Math.max(0.05, w))
    total += weights[weights.length - 1]
  }

  let x = r() * total
  for (let i = 0; i < list.length; i++) {
    x -= weights[i]
    if (x <= 0) return list[i]
  }
  return list[list.length - 1]
}

/**
 * 跑一格。返回做了什么，给 audit 用。
 * @param sea 识海 id
 */
export function tickOnce(sea, now) {
  const t = Number(now) || Date.now()
  const out = { sea, dims: null, drawn: null, seeded: false }

  // 一、情绪往底色回落
  let heart = defaultMood(tickHeart(readHeart()))
  const cur = heart.dims && typeof heart.dims === 'object'
    ? heart.dims
    : project((heart && heart.pad) || {})
  const next = towardBaseline(cur, BASELINE, 0.06)
  heart.dims = next
  heart.dimsAt = t
  out.dims = next

  // 二、抽一条被勾住
  const data = readSea(sea)
  const pts = (data && data.points) || []
  const pick = pickDrawn(pts, next, Math.random, heart.beingDrawn)
  if (pick) {
    const d = noteDrawn(heart, pick, t)
    out.drawn = d

    // 三、同一条被勾够了，记成"待成文"的线索（不假装是她的话）
    if (d && d.times >= DRAW_THRESHOLD) {
      try {
        const already = listThoughts(8, true).some(
          (x) => x.origin === 'pending' && Number(x.seedId) === Number(pick.id),
        )
        if (!already) {
          const r = addThought({
            text: '又想起「' + String(pick.title || '').slice(0, 30) + '」——还没说清',
            origin: 'pending',
            seedId: Number(pick.id),
            dim: DIM_KEYS.find((k) => next[k] === Math.max(...DIM_KEYS.map((x) => next[x]))) || '',
            dims: next,
            strength: 30,
          }, t)
          out.seeded = !!(r && r.ok)
        }
        // 记过就清零，别一小时写三条
        heart.beingDrawn = null
      } catch {}
    }
  }

  writeHeart(heart)
  recordDims(next, t)

  try {
    audit('selfmind-tick', {
      sea,
      drawn: out.drawn ? out.drawn.id : 0,
      times: out.drawn ? out.drawn.times : 0,
      seeded: out.seeded,
    })
  } catch {}

  return out
}
