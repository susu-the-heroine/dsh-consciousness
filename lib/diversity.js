/**
 * 结果多样性
 * ==========
 *
 * 「同主题不超过三条」——一个问句翻出来八条，六条在说同一件事，
 * 那不是记得多，是没得选。这里按标题判定「同一件事」，超过就把后面的压掉。
 *
 * 判定用标题的二字组重叠：≥ 0.6 就算同一主题。
 * 只看标题，不看正文——正文长的相似是常态，标题像才是真像。
 */

const STOP = /^(〔合成〕|\[合成\])/

function clean(s) {
  return String(s || '')
    .replace(STOP, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '')
}

function bigrams(s) {
  const x = clean(s)
  const out = new Set()
  if (x.length < 2) { if (x) out.add(x); return out }
  for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2))
  return out
}

/** 两个标题像不像同一件事：重叠占较短那条的比例 */
export function sameTopic(a, b, threshold = 0.6) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return false
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / Math.min(A.size, B.size) >= threshold
}

/**
 * 按主题压条数：每条候选保留，但同一主题最多 max 条。
 * 压掉的不是删除，是往后放——真需要时还能看见。
 *
 * @param {Array} list  已排好序的 [{p, ...}]
 * @param {number} limit 最终要几条
 * @param {number} max   同主题最多几条
 */
export function pickDiverse(list, limit = 8, max = 3, threshold = 0.6) {
  // 2026-11-21：进来之前要是有同一条被塞了两次（两个字面通道各捞到一次就会这样），
  // 这里不认编号，照样原样输出两条一样的。按编号去一次重。
  const _seen = new Set()
  const src = (Array.isArray(list) ? list : []).filter((x) => {
    const id = x && x.p && x.p.id
    if (id === undefined || id === null) return true
    const k = String(id)
    if (_seen.has(k)) return false
    _seen.add(k)
    return true
  })
  const kept = []
  const later = []
  const topics = [] // { title, n }
  for (const x of src) {
    // 2026-11-20：这里推完没 continue——同一条又被当新主题收进 kept，接着被 pop 回 later，
    // 同一条在 later 里出现两次，补位时又补进来，结果里就有重复。
    if (kept.length >= limit) { later.push(x); continue }
    const title = String((x && x.p && (x.p.title || x.p.titleFull)) || '')
    let hit = null
    for (const t of topics) {
      if (sameTopic(title, t.title, threshold)) { hit = t; break }
    }
    if (hit) {
      if (hit.n >= max) { later.push(x); continue }
      hit.n++
      kept.push(x)
      continue
    }
    topics.push({ title, n: 1 })
    kept.push(x)
    if (kept.length > limit) later.push(kept.pop())
  }
  const out = kept.slice(0, limit)
  // 不够数时用压下去的补，但补的时候还得守同主题上限——不然等于没压
  const cnt = []
  for (const x of out) {
    const title = String((x && x.p && (x.p.title || x.p.titleFull)) || '')
    const hit = cnt.find((c) => sameTopic(title, c.title, threshold))
    if (hit) hit.n++
    else cnt.push({ title, n: 1 })
  }
  for (const x of later) {
    if (out.length >= limit) break
    const title = String((x && x.p && (x.p.title || x.p.titleFull)) || '')
    const hit = cnt.find((c) => sameTopic(title, c.title, threshold))
    if (hit) {
      if (hit.n >= max) continue
      hit.n++
    } else cnt.push({ title, n: 1 })
    out.push(x)
  }
  return out
}
