/**
 * 关系状态机
 * ==========
 *
 * 四档：陌生 → 熟人 → 并肩 → 默契。
 *
 * 凭什么升：**一起经历过的事 + 兑现过的约定**。不凭聊天轮数——
 * 聊一万句客气话也不该变成"默契"。
 *
 * 降档规则（重要）：
 *   一次失信 **不降档**，但把"信任"打折。降档要两次失信、或者长期没兑现。
 *   理由：人不会因为一次爽约就翻脸，但会记住。
 */

export const STAGES = ['陌生', '熟人', '并肩', '默契']

/** 升到下一档需要多少分 */
const NEEDS = [0, 6, 16, 34]

/**
 * 算关系分。
 *
 * @param stat {events, kept, broken, days}
 *   events  一起经历过的事（记忆条数里算"共同经历"的那部分）
 *   kept    兑现的约定数
 *   broken  失信的约定数
 *   days    认识多少天
 */
export function relationScore(stat) {
  const s = stat || {}
  const events = Math.max(0, Number(s.events) || 0)
  const kept = Math.max(0, Number(s.kept) || 0)
  const broken = Math.max(0, Number(s.broken) || 0)
  const days = Math.max(0, Number(s.days) || 0)

  // 一起经历：对数增长，避免刷条数
  const eScore = Math.log1p(events) * 2.2
  // 兑现：一件就是一件，权重最高
  const kScore = kept * 2.4
  // 时间：老朋友是底分
  const dScore = Math.log1p(days) * 1.1

  // 注意：**失信不进这个分**。
  // 档位是"我们一起走过多少"，失信是"你还敢不敢信我"——两件事。
  // 混在一起会出现"爽约一次就退回熟人"，那不是人，那是合同。
  void broken
  return Number(Math.max(0, eScore + kScore + dScore).toFixed(2))
}

/** 分数 → 档位序号 0..3 */
export function stageIndex(score) {
  const s = Number(score) || 0
  let idx = 0
  for (let i = 1; i < NEEDS.length; i++) if (s >= NEEDS[i]) idx = i
  return idx
}

export function stageOf(stat) {
  const s = stat || {}
  const kept = Math.max(0, Number(s.kept) || 0)
  const broken = Math.max(0, Number(s.broken) || 0)
  let idx = stageIndex(relationScore(s))
  // 长期、成片地失信，掉一档——一次不算，一堆才算
  if (broken >= 3 && broken > kept * 2) idx = Math.max(0, idx - 1)
  return STAGES[idx]
}

/** 信任：被失信打折，但不会归零 */
export function trustOf(stat) {
  const s = stat || {}
  const kept = Math.max(0, Number(s.kept) || 0)
  const broken = Math.max(0, Number(s.broken) || 0)
  if (!kept && !broken) return 0.6          // 还没交过手：先给个中位
  const raw = kept / (kept + broken)
  // 一次失信最多回到 0.36，但不至于 0
  return Number(Math.max(0.2, Math.min(1, raw)).toFixed(3))
}

/** 还差多少分升下一档（已经到顶返回 0） */
export function toNext(score) {
  const idx = stageIndex(score)
  if (idx >= STAGES.length - 1) return 0
  return Number(Math.max(0, NEEDS[idx + 1] - (Number(score) || 0)).toFixed(2))
}

/** 一句话：现在什么关系。不吹、不肉麻 */
export function describeRelation(stat) {
  const score = relationScore(stat)
  const stage = STAGES[stageIndex(score)]
  const trust = trustOf(stat)
  let tail = ''
  if (trust < 0.4) tail = '，但信任还在打折'
  else if (trust > 0.85 && stage !== '陌生') tail = '，信得过'
  return '关系：' + stage + tail
}

/**
 * 从识海数据里数出关系统计。
 *
 * 这是唯一允许"关系从数据里长出来"的地方：
 *   events = 共同经历（非 promise/taboo 的记忆条数）
 *   kept   = 已兑现的约定
 *   broken = 过期还没兑现的约定（超过 14 天）
 *   days   = 从最早一条记忆到今天
 *
 * 刻意不数"对话轮数"——那是最容易刷、最没意义的指标。
 */
export function statsFrom(data, now) {
  const t = Number(now) || Date.now()
  const pts = ((data && data.points) || []).filter((p) => p && !p.dead)
  let events = 0
  let kept = 0
  let broken = 0
  let earliest = t
  for (const p of pts) {
    const kind = String(p.kind || '')
    if (kind === 'promise') {
      if (p.promiseStatus === 'done') kept++
      else {
        const due = Number(p.promiseDue) || 0
        if (due && due < t - 14 * 86400000) broken++
      }
    } else if (kind !== 'taboo') {
      events++
    }
    const b = Number(p.born) || 0
    if (b && b < earliest) earliest = b
  }
  const days = Math.max(0, Math.floor((t - earliest) / 86400000))
  return { events, kept, broken, days }
}
