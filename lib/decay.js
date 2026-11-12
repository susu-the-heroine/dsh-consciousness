/**
 * 衰减
 * ====
 *
 * 两个数，一个给人看，一个给机器判。
 *
 *   decayOf    —— 显示亮度。取幂律的 2.5 次方压一压，
 *                 球不会越堆越亮。S=30 天时：90 天 0.52、一年 0.19、十年 0.034。
 *
 *   rawDecayOf —— 真实可提取度。不压，看裸幂律。
 *                 归档该用这个——150 天的琐事在显示上是「记得」，真实只剩两成。
 *
 * 设定（isSetting）永不衰减。禁区、承诺、画像也永不衰减。
 */
import { MIN_STABILITY, retrievability } from '../assets/retention.js'
import { isSetting, forgettable } from './kinds.js'

/** 显示亮度：幂律 × 2.5 次方压缩，底线 0.06 */
export function decayOf(p, now = Date.now()) {
  if (!p) return 0
  if (isSetting(p) || p.gold) return 1
  if (!forgettable(p)) return 1
  if (p.validUntil) return 0.16
  const t0 = Math.max(Number(p.born) || 0, Number(p.lastSeen) || 0)
  if (!t0) return 0.5
  const age = Math.max(0, (now - t0) / 86400000)
  const S = Math.max(MIN_STABILITY, Number(p.strength) || (30 + (p.arousal || 5) * 6))
  const r = retrievability(age, S)
  const shown = Math.pow(r, 2.5)
  return Math.max(0.06, Math.min(1, shown))
}

/** 裸衰减：归档判断用。90 天 0.86、一年 0.64、十年 0.26 */
export function rawDecayOf(p, now = Date.now()) {
  if (!p) return 0
  if (isSetting(p) || p.gold) return 1
  if (p.validUntil) return 0.16
  if (!forgettable(p)) return 1
  const t0 = Math.max(Number(p.born) || 0, Number(p.lastSeen) || 0)
  if (!t0) return 0.5
  const age = Math.max(0, (now - t0) / 86400000)
  const S = Math.max(MIN_STABILITY, Number(p.strength) || (30 + (p.arousal || 5) * 6))
  return retrievability(age, S)
}

/** 按衰减后的真实亮度排序用的比较器 */
export function byDecay(now) {
  return (a, b) => decayOf(b, now) - decayOf(a, now)
}

/* ---------- 分档遗忘 ----------
 * 连续亮度（0.06~1.0）能排序，但说不出「她还能讲出多少细节」。
 *
 * 五档：
 *   清晰   —— 细节都在，能复述原话
 *   记得   —— 主要情节在，细节模糊
 *   轮廓   —— 只记得有这么回事
 *   影子   —— 知道发生过，说不出内容
 *   快没了 —— 只剩一个标题
 */
export const FADE_STAGES = [
  { min: 0.80, key: 'vivid',    label: '清晰',   canDetail: true },
  { min: 0.55, key: 'clear',    label: '记得',   canDetail: true },
  { min: 0.32, key: 'outline',  label: '轮廓',   canDetail: false },
  { min: 0.15, key: 'shadow',   label: '影子',   canDetail: false },
  { min: 0.00, key: 'fading',   label: '快没了', canDetail: false },
]

/** 这条现在在五档里的哪一档 */
export function stageOf(p, now = Date.now()) {
  const d = decayOf(p, now)
  for (const s of FADE_STAGES) {
    if (d >= s.min) return s
  }
  return FADE_STAGES[FADE_STAGES.length - 1]
}

/** 现在还能不能讲出细节 */
export function canRecallDetail(p, now = Date.now()) {
  return stageOf(p, now).canDetail
}
