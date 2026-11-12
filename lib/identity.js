/**
 * 身份底片
 * ========
 *
 * 什么该永不衰减：**"她是谁"**。
 *
 * 七卷档案、名字的来历、绝不顺着你、不许提那两个字——这些东西如果也走幂律衰减，
 * 过上一年她会变成一个礼貌的陌生人。所以单独一层：底片。
 *
 * 底片怎么选：
 *   一、手动指定（kind=taboo / 核心设定）优先
 *   二、其次是被反复想起的（recallCount 高）
 *   三、最多 7 条，每次注入都带
 *
 * 底片不按时间衰减，只按"被覆盖"淘汰——同样的意思有更新的，旧的让位。
 */

/** 最多几条底片 */
export const MAX_ANCHORS = 7

/** 一条记忆够不够格当底片 */
export function anchorScore(p) {
  if (!p || p.dead) return 0
  const kind = String(p.kind || '')
  let s = 0
  if (kind === 'taboo') s += 1.0        // 禁区：不能碰的
  if (kind === 'promise') s += 0.45     // 承诺：她答应过的事
  if (p.layer === 'core') s += 0.35     // 本来就标了核心层
  s += Math.min(1, (Number(p.imp) || 0)) * 0.3
  s += Math.min(0.3, (Number(p.recallCount) || 0) * 0.03)
  return Number(s.toFixed(4))
}

/**
 * 选底片。稳定优先：同样的分数不来回换，否则每次注入的"她是谁"都在变。
 */
export function pickAnchors(points, limit) {
  const n = Math.max(1, Number(limit) || MAX_ANCHORS)
  const scored = (points || [])
    .filter((p) => p && !p.dead && !p.archived)
    .map((p) => ({ p, s: anchorScore(p) }))
    .filter((x) => x.s > 0.35)
    .sort((a, b) => (b.s - a.s) || (Number(a.p.id) - Number(b.p.id)))
  return scored.slice(0, n).map((x) => x.p)
}

/**
 * 一句话：她是谁。
 * 只用底片里最短的那几条拼，不超过 budget 字——**底片也不能把对话挤没了**。
 */
export function identityLine(points, budget = 160) {
  const picks = pickAnchors(points, MAX_ANCHORS)
  if (!picks.length) return ''
  let out = ''
  for (const p of picks) {
    const t = String(p.title || '').trim()
    if (!t) continue
    if ((out + t).length > budget) break
    out += (out ? '、' : '') + t
  }
  return out ? '她的底子：' + out + '（这些不随时间变淡）' : ''
}
