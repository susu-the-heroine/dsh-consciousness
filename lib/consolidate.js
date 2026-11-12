/**
 * 沉底前自查（我们自己的，不是抄别人的梦境整合）
 * ==========================================
 *
 * 起因：夜深了、没人说话，人会在睡前把当天的事过一遍——
 * 不是编新故事，是把"快要掉下去但还值钱"的那几件再掂一掂。
 *
 * 这里的规矩，跟"被想起一次"故意分开：
 *   · 想起了（reinforcePoint）= 真的碰过：lastSeen、recallCount、arousal 都变
 *   · 沉底前自查 = 没碰过任何人：**只把 strength 抬一半**，
 *     lastSeen / recallCount / arousal 一个都不许动。
 *   否则记忆会"自欺"：明明没人提，它却以为被想起来了。
 *
 * 挑谁：正在淡、但还没淡完、而且值钱的那几条。
 *   太亮的不需要（还好好的），太暗的别硬救（那就是该沉了）。
 */
import { growStability, initialDifficulty, retrievability, MIN_STABILITY } from '../assets/retention.js'
import { rawDecayOf } from './decay.js'
import { isSetting, forgettable } from './kinds.js'

/** 安静多久算"静下来"（毫秒）。2 小时。 */
export const QUIET_MS = 2 * 3600 * 1000

const BRIGHT_ABOVE = 0.62   // 比这亮：不需要掂
const DIM_BELOW = 0.12      // 比这暗：该沉了，别硬救
const MIN_IMP = 0.5

/**
 * 挑出这一轮该掂的。
 * @returns {{pick: object[], reason: object}}
 */
export function pickForReview(data, now = Date.now()) {
  const pts = (data && data.points) || []
  const pick = []
  let skipSetting = 0, skipBright = 0, skipDim = 0, skipCheap = 0

  for (const p of pts) {
    if (!p || p.dead || p.archived) continue
    if (!forgettable(p) || isSetting(p) || p.gold) { skipSetting++; continue }
    if (p.validUntil) { skipSetting++; continue }
    const r = rawDecayOf(p, now)
    if (r > BRIGHT_ABOVE) { skipBright++; continue }
    if (r < DIM_BELOW) { skipDim++; continue }
    const imp = Number(p.imp) || 0
    const hits = Number(p.recallCount) || 0
    if (imp < MIN_IMP && hits < 2) { skipCheap++; continue }
    pick.push({ p, r })
  }

  // 越淡、越值钱，越该先掂
  pick.sort((a, b) => (a.r * (1 - (Number(a.p.imp) || 0))) - (b.r * (1 - (Number(b.p.imp) || 0))))

  return {
    pick: pick.map((x) => ({ point: x.p, r: Number(x.r.toFixed(3)) })),
    reason: { skipSetting, skipBright, skipDim, skipCheap, total: pts.length },
  }
}

/**
 * 掂一遍：只涨 strength 的一半，别的都不动。
 * @param {object[]} picks  pickForReview().pick
 * @param {number} cap 一次最多掂几条
 */
export function reviewPoints(picks, { cap = 12, now = Date.now() } = {}) {
  const done = []
  for (const { point: p, r } of picks.slice(0, cap)) {
    const a = typeof p.arousal === 'number' ? p.arousal : 5
    const s0 = Math.max(MIN_STABILITY, Number(p.strength) || (30 + a * 6))
    const d = Number(p.difficulty)
    const diff = Number.isFinite(d) ? d : initialDifficulty({ importance: Number(p.imp) || 0.5 })
    const grown = growStability(s0, diff, Math.max(0.01, Math.min(1, r)))

    // 只取增长量的一半：这是"掂了掂"，不是"想起来"
    p.strength = s0 + (grown - s0) * 0.5
    p.reviewedAt = now
    p.reviewCount = (Number(p.reviewCount) || 0) + 1
    done.push({ id: p.id, from: Number(s0.toFixed(1)), to: Number(p.strength.toFixed(1)), r })
  }
  return done
}

/**
 * 一整轮：挑 + 掂 + 记账。dry=true 只看不写。
 */
export function consolidate(data, { dry = false, cap = 12, now = Date.now() } = {}) {
  const { pick, reason } = pickForReview(data, now)
  if (dry) {
    return {
      dry: true,
      would: pick.slice(0, cap).length,
      total: pick.length,
      reason,
      sample: pick.slice(0, 5).map((x) => ({ id: x.point.id, title: String(x.point.title || '').slice(0, 18), r: x.r, imp: x.point.imp })),
    }
  }
  const done = reviewPoints(pick, { cap, now })
  if (!data.meta) data.meta = {}
  data.meta.lastConsolidate = now
  if (!Array.isArray(data.meta.consolidations)) data.meta.consolidations = []
  data.meta.consolidations.push({ at: now, n: done.length, ids: done.map((d) => d.id) })
  if (data.meta.consolidations.length > 50) data.meta.consolidations = data.meta.consolidations.slice(-50)
  return { n: done.length, reason, done }
}

/**
 * 现在该不该跑：安静够久，且这一轮安静还没跑过。
 */
export function shouldReview(data, lastActiveAt, now = Date.now()) {
  const last = Math.max(Number(lastActiveAt) || 0, Number(data?.meta?.lastConsolidate) || 0)
  if (!last) return false
  return now - last >= QUIET_MS
}
