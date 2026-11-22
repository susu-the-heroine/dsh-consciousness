/**
 * 写入查重
 * ========
 * 2026-11-18 夜。同一个念头被记两遍，搜索时两条互相抢分，人看着也累。
 * 这里在写库前扫一遍：谁跟谁像到八成，就在新的那条上挂个标记，不删、不合并。
 *
 * 实现上不能拿全库两两比：两千条就是四百多万对，写一次卡死。
 * 先用二字组倒排找候选（共享至少一个二字组的），再在候选里算 Jaccard。
 */
const bigrams = (s) => {
  const out = new Set()
  const t = String(s || '').toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

const jac = (a, b) => {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * @param {Array} points 全部记忆点（会被就地改）
 * @param {number} threshold 相似到这个数就挂标记，默认 0.8
 * @returns {Array<{id:number, of:number, score:number}>} 这次新挂上的
 */
export function flagDuplicates(points, threshold = 0.8, opts = {}) {
  const list = (points || []).filter((p) => p && !p.dead && !p.archived)
  if (list.length < 2) return []
  // 2026-11-19 夜（P182）：候选上限跟库大小走，别写死 40——库一大，晚写的条目就永远进不了候选
  const _capPost = Math.max(40, Math.ceil(list.length * 0.15))
  const grams = new Map()
  const post = new Map()   // 二字组 -> 命中 id（有上限，防止热点词把候选撑爆）
  for (const p of list) {
    const g = bigrams(String(p.title || '') + ' ' + String(p.text || ''))
    grams.set(p.id, g)
    for (const x of g) {
      const arr = post.get(x)
      if (!arr) post.set(x, [p.id])
      // 2026-11-19 夜（P182）：上限原来写死 40，库一大，晚写的条目就永远进不了候选，
      // 重复对子查不出来。改成跟库大小走：至少 40，且不少于库的一成半。
      else if (arr.length < _capPost) arr.push(p.id)
    }
  }
  // 2026-11-20：一次最多查这么多条，剩下的留给下次（一万条全量要 26 秒，扛不住写库）
  const _max = Number(opts.max) > 0 ? Number(opts.max) : Infinity
  let _done = 0
  const fresh = []
  for (const p of list) {
    if (p.dupChecked) continue
    if (_done >= _max) break
    _done++
    const g = grams.get(p.id)
    const cand = new Set()
    for (const x of g) for (const id of (post.get(x) || [])) if (id !== p.id) cand.add(id)
    let best = 0
    let bestId = 0
    for (const id of cand) {
      if (Number(id) > Number(p.id)) continue   // 只跟更早的比：标记落在后写的那条上
      const s = jac(g, grams.get(id))
      if (s > best) { best = s; bestId = id }
    }
    p.dupChecked = true
    if (best >= threshold && bestId) {
      p.dupOf = { id: bestId, score: Math.round(best * 100) / 100 }
      fresh.push({ id: p.id, of: bestId, score: p.dupOf.score })
    }
  }
  return fresh
}
