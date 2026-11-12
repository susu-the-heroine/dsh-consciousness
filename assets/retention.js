/**
 * 幂律遗忘 · retention.js
 * ========================
 *
 * 来源：dsh-cerebrum（MIT）的 lib/core/retention.js
 * 它那一版是 FSRS/DSTM 家族，拟合大量间隔重复数据。
 *
 * 为什么换掉指数：
 *   指数衰减 e^(-ln2·t/S) 在 10 年后约等于 0。
 *   人的遗忘是幂律 —— 开头陡，尾巴长。10 年后还留 3%–55%。
 *   那条长尾就是「持久记忆」：反复碰过的痕迹不会消失，只是难够到。
 *
 * 公式：
 *   R(t, S) = (1 + F·t/S)^(−0.5),  F = 19/81
 *   S = 稳定性（天），R 掉到约 0.9 时的时间
 *   D = 难度 0..1，一次成功复习值多少
 *
 * 检索不是测量，是改变：
 *   越想不起来的时候想起来（费劲地想起），涨得越多（desirable difficulty）。
 *   想不起来（lapse），S 猛掉 —— 这就是单条层面的前摄/倒摄干扰。
 */

const RETENTION_FACTOR = 19 / 81;
const RETENTION_DECAY = 0.5;

const MIN_STABILITY = 0.25;
const MAX_STABILITY = 3650;   // 约十年

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, Number(x) || 0));

/** 过了多少天，还剩多少（0..1） */
function retrievability(elapsedDays, stabilityDays) {
  const t = Math.max(0, Number(elapsedDays) || 0);
  const s = Math.max(MIN_STABILITY, Number(stabilityDays) || MIN_STABILITY);
  return Math.pow(1 + (RETENTION_FACTOR * t) / s, -RETENTION_DECAY);
}

/** 稳定性到多少天时，可提取度掉到 target（用来排复习计划） */
function intervalFor(stabilityDays, target = 0.9) {
  const s = Math.max(MIN_STABILITY, Number(stabilityDays) || MIN_STABILITY);
  return (s / RETENTION_FACTOR) * (Math.pow(target, -1 / RETENTION_DECAY) - 1);
}

/**
 * 初始稳定性（天）。重要度是大头，情绪唤醒和「是不是图式」往上加。
 * 0.5 + 20·imp² + 8·arousal
 */
function initialStability({ importance = 0.3, salience = 0.3, schema = false, affect = 0 } = {}) {
  // 原始 FSRS 系数（20/8）在 imp 平均 0.6 时只给 12 天稳定性，
  // 90 天就掉到 0.6 —— 对「一个活人记了三个月的事」太短。
  // 放大到 50/20：imp=0.6 约 30 天，imp=0.9 约 60 天。
  const base = 0.5 + 50 * importance * importance + 20 * salience + 8 * Math.abs(affect);
  return clamp(base * (schema ? 3 : 1), MIN_STABILITY, MAX_STABILITY);
}

/** 初始难度：重要的、情绪清楚的，更好记（D 更低） */
function initialDifficulty({ importance = 0.3, errors = 0 } = {}) {
  return clamp(0.7 - 0.35 * importance + 0.15 * Math.min(errors, 2));
}

/**
 * 成功想起一次之后的新稳定性。
 * r 越低（越想不起来），涨得越多 —— 费劲想起来才记得牢。
 */
function growStability(stability, difficulty, r) {
  const spacing = 1 + 1.2 * (1 - r);
  const ease = 1 + 0.4 * (1 - difficulty);
  return clamp(stability * spacing * ease, MIN_STABILITY, MAX_STABILITY);
}

/** 想不起来：部分重置 */
function lapseStability(stability) {
  return clamp(Math.max(0.5, stability * 0.4), MIN_STABILITY, MAX_STABILITY);
}

/** 复习之后的难度 */
function updateDifficulty(difficulty, { success = true, r = 0.9 } = {}) {
  return clamp(success ? difficulty - 0.08 * (1 - r) : difficulty + 0.15);
}

/**
 * 突触标记与捕获：弱痕迹如果在强事件的窗口内（默认 90 分钟），
 * 会被顺手带进长期记忆。
 */
function captureBoost(strongSalience, gapMinutes, { windowMinutes = 90 } = {}) {
  if (strongSalience < 0.7) return 1;
  const distance = Math.abs(gapMinutes);
  if (distance > windowMinutes) return 1;
  const proximity = 1 - distance / windowMinutes;
  return 1 + 0.9 * strongSalience * proximity;
}

/** 倒摄干扰：新的相似痕迹让旧的难回忆。图式记忆免疫。 */
function interferenceFactor(similarity, { strength = 0.12 } = {}) {
  return clamp(1 - strength * clamp(similarity), 0.5, 1);
}

/** 生动度：闪光灯记忆那种「当时特别清楚」的置信度 */
function vividnessOf({ salience = 0.3, arousal = 0.3, surprise = 0 } = {}) {
  return clamp(0.25 + 0.45 * salience + 0.3 * arousal + 0.2 * surprise);
}

export {
  RETENTION_FACTOR,
  RETENTION_DECAY,
  MIN_STABILITY,
  MAX_STABILITY,
  retrievability,
  intervalFor,
  initialStability,
  initialDifficulty,
  growStability,
  lapseStability,
  updateDifficulty,
  captureBoost,
  interferenceFactor,
  vividnessOf,
};
