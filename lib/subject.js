/**
 * 「这事记着吗」——一处判据，四处引用
 * ============================
 * 灰区要的不是「问句里两个字撞上」，那样编出来的东西也能撞上。
 * 判据一：问句里的两字词至少三条撞上同一条（宽松，管长句）。
 * 判据二（2026-11-21 加）：问句里有一段三字以上的原话，库里只有一到三条沾边——
 *   那一段就是「这件事的名字」，哪怕别名短、只能凑出两个两字词，也算撞上。
 *   起因：「咬抖音多少播放」被答成「没记过」，可库里明明白白有《我的黄金战绩——《咬抖音Logo》》。
 */
export function subjectHit(query, points) {
  try {
    const q = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
    if (q.length < 3) return null
    const arr = Array.isArray(points) ? points : []
    const live = []
    for (const item of arr) {
      const p = item && item.p ? item.p : item
      if (!p || p.dead || p.archived) continue
      live.push({ p, t: String(p.title || '') + ' ' + String(p.alias || '') + ' ' + String(p.text || '') })
    }

    // 判据一：两字词至少三条
    const gs = []
    for (let i = 0; i + 2 <= q.length; i++) gs.push(q.slice(i, i + 2))
    let best = null
    let bestRun = 0
    for (const { p, t } of live) {
      let n = 0
      for (const g of gs) if (t.includes(g)) n++
      if (n > bestRun) { bestRun = n; best = p }
    }
    if (bestRun >= 3) return best

    // 判据二：稀有三字片段（库里只有一到三条沾边）
    const runs = []
    for (let i = 0; i + 3 <= q.length; i++) {
      const r = q.slice(i, i + 3)
      if (!runs.includes(r)) runs.push(r)
    }
    let rare = null
    let rareDf = 999
    // 只认「标题里原样有这三个字」——「门牌号」「叫什么名字」这种通用词也会稀有，
    // 但标题里没有，就不算这件事的名字。2026-11-21 拒答四道闸两条就是这么挂的。
    for (const r of runs) {
      let df = 0
      for (const { p } of live) if (String(p.title || '').includes(r)) df++
      if (df > 0 && df <= 3 && df < rareDf) { rareDf = df; rare = r }
    }
    if (!rare) return null
    let pick = null
    let pickScore = -1
    for (const { p, t } of live) {
      if (!String(p.title || '').includes(rare)) continue
      let n = 0
      for (const g of gs) if (t.includes(g)) n++
      // 同分时偏向标题里真有这三个字的
      const inTitle = String(p.title || '').includes(rare) ? 1 : 0
      const score = n * 2 + inTitle
      if (score > pickScore) { pickScore = score; pick = p }
    }
    return pick
  } catch {
    return null
  }
}
