/**
 * 被想起一次
 * ==========
 *
 * 间隔重复：想三次的事比想一次的事难忘三倍，不是拍脑袋。
 * 用 FSRS 的 growStability：越想不起来的时候想起来，涨得越多（desirable difficulty）。
 */
import { initialDifficulty, growStability, updateDifficulty, retrievability, MIN_STABILITY } from '../assets/retention.js'

/** 被想起一次：强度涨一截，记下次数和时间。
 *  这是间隔重复——想三次的事比想一次的事难忘三倍，不是拍脑袋。 */
export function reinforcePoint(p) {
  const now = Date.now()
  const a = typeof p.arousal === 'number' ? p.arousal : 5
  const s0 = Math.max(MIN_STABILITY, Number(p.strength) || (30 + a * 6))

  // 想起的那一刻，它还剩多少 —— 决定这次涨多少
  const t0 = Math.max(Number(p.born) || 0, Number(p.lastSeen) || 0) || now
  const age = Math.max(0, (now - t0) / 86400000)
  const r = retrievability(age, s0)

  // FSRS：越想不起来的时候想起来，涨得越多（desirable difficulty）
  const d = Number(p.difficulty)
  const diff = Number.isFinite(d) ? d : initialDifficulty({ importance: Number(p.imp) || 0.5 })
  p.strength = growStability(s0, diff, r)
  p.difficulty = updateDifficulty(diff, { success: true, r })

  p.recallCount = (Number(p.recallCount) || 0) + 1
  p.lastSeen = now
  p.arousal = Math.min(10, a + 0.1)
  return p
}
