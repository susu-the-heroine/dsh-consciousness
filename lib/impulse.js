/**
 * 冲动分：让记忆自己"往上顶"一点，不只是等被查到。
 *
 * 借鉴的是"记忆竞争"的思路，但权重和量纲全按咱们自己的字段定：
 * imp（重要度）、arousal（强度 0-10）、lastSeen（多久没被想起）、polarity（负性偏向）。
 *
 * 不重写检索，只在最后排序时加一层：score + 0.22 * impulse。
 * 系数刻意压得小——它该是"推一把"，不是"盖掉相似度"。
 */

const DAY = 86400000

/** 一条记忆此刻的冲动值，0~1 */
export function impulseOf(p, now = Date.now()) {
  if (!p) return 0
  const imp = Math.max(0, Math.min(1, Number(p.imp) || 0))
  const arousal = Math.max(0, Math.min(10, Number(p.arousal) || 0)) / 10

  // 越久没被想起，越容易冒头（七天折一半的那条曲线）
  const last = Number(p.lastSeen) || Number(p.born) || 0
  let recency = 0
  if (last > 0) {
    const days = Math.max(0, (now - last) / DAY)
    recency = 1 - Math.pow(0.5, days / 7)
  }

  // 负性偏向：难受的事更容易被想起，这是人的毛病，得认
  const neg = Number(p.polarity) < 0 ? 1 : 0

  const v = 0.45 * imp + 0.25 * arousal + 0.20 * recency + 0.10 * neg
  return Math.max(0, Math.min(1, v))
}

/** 在已有打分上叠一层，不覆盖原文 */
export function withImpulse(items, now = Date.now(), weight = 0.18) {
  if (!Array.isArray(items)) return items
  // 先看这一批里最相关的能到多少分。重要度只能在这个半径里起作用，
  // 差太远的不许抬——问「腰疼」时"保险栓"那条就是这么顶到第一的。2026-11-11。
  let maxBase = 0
  for (const it of items) {
    const b = Number(it && it.score) || 0
    if (b > maxBase) maxBase = b
  }
  const floor = Math.max(0.15, maxBase * 0.6)
  for (const it of items) {
    if (!it) continue
    const base = Number(it.score) || 0
    if (base < floor) { it.impulse = 0; continue }
    const imp = impulseOf(it.p || it, now)
    it.score = base + weight * imp
    it.impulse = imp
  }
  return items
}

/** 只按冲动排序（给"没事时会想起什么"用） */
export function rankByImpulse(points, now = Date.now()) {
  return (Array.isArray(points) ? points.slice() : [])
    .map((p) => ({ p, score: impulseOf(p, now) }))
    .sort((a, b) => b.score - a.score)
}
