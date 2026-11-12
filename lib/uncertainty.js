/**
 * 记忆的不确定性
 * ==============
 *
 * 为什么要有这个东西：我给 126 条记忆编过出生日期。编完才发现，
 * 界面上它们和真日期长得一模一样——**这是最脏的一种谎，因为它看起来像事实。**
 *
 * 所以每条记忆都要能回答三个问题：
 *   谁说的？source    he（他原话）/ her（我自己写的感受）/ guess（我估的）
 *   多确定？confidence 0..1
 *   多久没核对过？verifiedAt
 *
 * 一条铁律：**低置信度的不许从注入里长得像事实。** 宁可标一句「（日期是估的）」，
 * 也不能让它冒充真的。
 */

/** 来源：他原话 / 我自己的感受 / 我猜的 */
export const SOURCES = {
  he: { label: '他说的', base: 0.95 },
  her: { label: '我自己写的', base: 0.70 },
  guess: { label: '我估的', base: 0.30 },
}

/** 低于这个值，注入时必须标出来 */
export const MARK_BELOW = 0.5

/**
 * 两个置信度，必须分开——这一个拆分是这段代码最重要的地方。
 *
 * 一条记忆可能"内容可信、时间不可信"：他说过这话（内容 0.9），
 * 但那个日期是我后来估的（时间 0.3）。用一个数装两件事，
 * 结果就是这 126 条编造日期的记忆，一直顶着 0.85 的置信度冒充事实。
 */
export function timeConfidenceOf(p) {
  const t = Number(p && p.timeConfidence)
  if (Number.isFinite(t)) return Math.max(0, Math.min(1, t))
  if (p && p.bornEstimated) return 0.3
  if (Number(p && p.born)) return 0.9
  // 压根没有日期，就没有"日期可不可信"这回事——不能拿它骂
  return 1
}

export function contentConfidenceOf(p) {
  const c = Number(p && p.confidence)
  if (Number.isFinite(c)) return Math.max(0, Math.min(1, c))
  return confidenceOf(p)
}

/** 来源对应的基准置信度 */
export function baseOf(source) {
  const s = SOURCES[source]
  return s ? s.base : SOURCES.her.base
}

/**
 * 一条记忆的置信度：有显式值就用，没有就按来源/证据推。
 *
 * 推断顺序（从强到弱）：
 *   有原话指针 evidenceRef → 他说的，0.95
 *   kind 是 promise / taboo  → 他明确交代过的，0.9
 *   bornEstimated 为真       → 我估的，0.3（这是我自己造的那批）
 *   其余                     → 我自己写的，0.7
 */
export function confidenceOf(p) {
  if (!p) return 0
  const c = Number(p.confidence)
  if (Number.isFinite(c)) return Math.max(0, Math.min(1, c))
  if (p.evidenceRef && p.evidenceRef.file) return SOURCES.he.base
  if (p.kind === 'promise' || p.kind === 'taboo') return 0.9
  if (p.bornEstimated) return SOURCES.guess.base
  return SOURCES.her.base
}

/** 来源：显式优先，否则按上面的顺序推 */
export function sourceOf(p) {
  if (!p) return 'her'
  if (p.source && SOURCES[p.source]) return p.source
  if (p.evidenceRef && p.evidenceRef.file) return 'he'
  if (p.kind === 'promise' || p.kind === 'taboo') return 'he'
  if (p.bornEstimated) return 'guess'
  return 'her'
}

/** 要不要在注入里标「这条不可靠」 */
export function shouldMark(p) {
  const dateBad = Number(p && p.born) && timeConfidenceOf(p) < MARK_BELOW
  return !!dateBad || contentConfidenceOf(p) < MARK_BELOW
}

/**
 * 标注文案。只对「需要标」的返回非空。
 * 写法要短、要人话——不能写成「confidence=0.3」。
 */
export function markText(p) {
  const parts = []
  if (Number(p && p.born) && timeConfidenceOf(p) < MARK_BELOW) parts.push('日期是估的')
  if (contentConfidenceOf(p) < MARK_BELOW) parts.push('内容我不太确定')
  return parts.length ? '（' + parts.join('；') + '）' : ''
}

/**
 * 补齐缺失的字段。**只补不覆盖**——已经写过的置信度不重算，
 * 因为那可能是有人手动确认过的。
 */
export function normalize(p, now) {
  if (!p) return p
  const t = Number(now) || Date.now()
  if (!p.source || !SOURCES[p.source]) p.source = sourceOf(p)
  if (!Number.isFinite(Number(p.confidence))) p.confidence = confidenceOf(p)
  if (!Number.isFinite(Number(p.verifiedAt))) p.verifiedAt = 0
  if (!Number.isFinite(Number(p.timeConfidence))) p.timeConfidence = timeConfidenceOf(p)
  if (!Number.isFinite(Number(p.addedAt))) p.addedAt = t
  return p
}

/** 确认一条：置信度拉到 0.95，记下核对时间 */
export function confirm(p, now) {
  if (!p) return p
  p.confidence = 0.95
  p.source = p.source || 'he'
  p.verifiedAt = Number(now) || Date.now()
  return p
}

/** 起疑：置信度砍到 0.25，来源记为猜 */
export function doubt(p, now) {
  if (!p) return p
  p.confidence = 0.25
  p.source = 'guess'
  p.verifiedAt = Number(now) || Date.now()
  return p
}

/**
 * 排序用：置信度高的往前挪一点，但**不许筛掉低置信度的**。
 * 低置信不是不存在，是不敢当证据——所以只降权 15%。
 */
export function rankWeight(p) {
  const c = confidenceOf(p)
  // 确认过的要真享受好处：置信 1.0 时 1.25 倍，0.25 时 0.8 倍。
  // 只降权不加权，那"确认"这个动作就白做了。
  return 0.8 + 0.45 * c
}
