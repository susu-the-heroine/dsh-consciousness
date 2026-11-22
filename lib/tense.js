/**
 * 时态择向
 * ======
 *
 * 「他当时打算干什么」和「他现在打算干什么」问的是两件事。
 * 但引擎只看字面：两条记忆说法差不多，谁分高谁上，跟时间一点关系没有。
 *
 * 这里只做一件事：问句里带过去/现在标记时，在前几条里挑出生日合适的往前挪。
 * 只在分差不大（八成五以内）时挪，不动有没有、不加不减，判不准就原样。
 */

const PAST = /当时|那时候|那会儿|以前|从前|当年|过去|上回|上次/
const NOW = /现在|如今|目前|眼下|最近|这阵子|这会儿/

export function tenseOf(query) {
  const q = String(query || '')
  if (PAST.test(q) && !NOW.test(q)) return 'past'
  if (NOW.test(q) && !PAST.test(q)) return 'now'
  return ''
}

/**
 * @param {string} query 问句
 * @param {Array} list  已经排好序的候选（每项 { p: { born }, score }）
 * @param {number} topK 只在前几条里挑
 * @returns 新数组；没触发就原样返回
 */
export function applyTenseRank(query, list, topK = 5) {
  const arr = Array.isArray(list) ? list : []
  const t = tenseOf(query)
  if (!t || arr.length < 2) return arr
  const head = arr.slice(0, topK)
  const bornOf = (x) => Number((x && x.p && x.p.born) || 0)
  const top = head[0]
  const topScore = Number(top.score) || 0
  if (topScore <= 0) return arr
  // 在分差一成五以内的人里，挑最老或最新的那位
  let pick = null
  for (const x of head) {
    const s = Number(x.score) || 0
    if (s < topScore * 0.85) continue
    if (!bornOf(x)) continue
    if (!pick) { pick = x; continue }
    if (t === 'past' ? bornOf(x) < bornOf(pick) : bornOf(x) > bornOf(pick)) pick = x
  }
  if (!pick || pick === top) return arr
  const out = arr.filter((x) => x !== pick)
  out.unshift(pick)
  return out
}
