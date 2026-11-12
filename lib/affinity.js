/**
 * 情绪同频
 * ========
 *
 * 检索只看「内容像不像」，会漏掉一维：**这条记忆当时是什么情绪。**
 * 他这会儿憋屈着，问「那次他骂我」，最该浮上来的不是字面最像的那条，
 * 是那条当时也憋着的。
 *
 * 所以打分加一项：极性同号 + 强度接近，就给一点加分。
 *
 * 三条硬规矩，写在代码里，不许改：
 *   一、极性不明（|v| < 0.15）不加分。她自己都没确定是暖是冷，别装懂。
 *   二、极性相反不加分。开心的时候不该翻出最痛的那条。
 *   三、强度差超过一半不加分。都是「难过」，0.9 和 0.1 不是一回事。
 *
 * 加多少：最多 0.10 分。这个量级刚好能挪动一两位，挪不动整张榜。
 * 太大就成了「情绪绑架检索」，问事实也会翻出情绪最浓的那几条。
 */

import { readLive } from './live.js'

/** 极性阈值：低于这个就当没极性 */
const V_DEAD = 0.15
/** 强度差超过这个（0..10 量纲）就不算同频 */
const A_MAX_GAP = 5
/** 满分加多少 */
const MAX_BONUS = 0.10

/**
 * @param {{v:number,a:number}} pad  她这会儿的 PAD（v=-1..1，a=0..1）
 * @param {{polarity:number,arousal:number}} point 记忆的极性与强度（-1/0/1，0..10）
 * @returns {{bonus:number, prox:number, reason:string}} prox=近似度 0..1
 */
export function emotionAffinity(pad, point) {
  const none = { bonus: 0, prox: 0, reason: '' }
  if (!pad || !point) return none

  const v = Number(pad.v)
  if (!Number.isFinite(v) || Math.abs(v) < V_DEAD) return none      // 极性不明
  const moodSign = Math.sign(v)

  const mp = Number(point.polarity)
  if (!Number.isFinite(mp) || mp === 0) return none                  // 这条没标极性
  if (mp !== moodSign) return none                                   // 极性相反

  const a = Math.max(0, Math.min(1, Number(pad.a) || 0)) * 10
  const pa = Number(point.arousal)
  if (!Number.isFinite(pa)) return none

  const gap = Math.abs(a - pa)
  if (gap > A_MAX_GAP) return none                                   // 强度差太远

  const prox = Math.max(0, 1 - gap / 10)
  // 加多少改成热参数：想试八维影响够不够，改配置文件就行，不用重启。
  // 上限的来源顺序：环境变量（只给测试/排障用）→ 热配置 → 常量。
  // 测试必须能钉死这个数，否则现场改过配置，单测就红——2026-11-12 修。
  let cap = MAX_BONUS
  try { const v = Number(readLive().affinityMax); if (Number.isFinite(v) && v > 0) cap = v } catch {}
  try {
    const env = Number(process.env.DSH_AFFINITY_MAX)
    if (Number.isFinite(env) && env > 0) cap = env
  } catch {}
  return {
    bonus: cap * prox,
    prox,
    reason: '同频 ' + prox.toFixed(2),
  }
}
