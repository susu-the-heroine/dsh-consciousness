/**
 * 接话：你说到这儿，我顺嘴提一句
 * ==========================
 *
 * 不是「它想起来」，是「你那句话勾出来的」。
 * 所以只看你问的那几个字，不看时间、不看情绪。
 *
 * 三道闸，缺一不出声：
 *   1. 问句里的三字切片，至少两个出现在别的条目里（2026-11-20 按实现改准：不是「有一处三字重合」就够）
 *   2. 那条不在这次结果里（已经给过的别再提）
 *   3. 十分钟内只接一次（接多了就是烦）
 */

export function pickFollowUp(query, data, shownIds, nowMs, lastAt) {
  try {
    const q = String(query || '').replace(/\s+/g, '')
    if ([...q].length < 4) return { line: '', at: Number(lastAt) || 0 }
    const now = Number(nowMs) || Date.now()
    const last = Number(lastAt) || 0
    if (last && now - last < 10 * 60 * 1000) return { line: '', at: last }

    const pts = (data && Array.isArray(data.points) ? data.points : []).filter((p) => p && !p.dead && !p.archived)
    const shown = new Set((shownIds || []).map(Number))
    const bigrams = new Set()
    for (let i = 0; i < q.length - 2; i++) bigrams.add(q.slice(i, i + 3))
    if (!bigrams.size) return { line: '', at: last }

    let best = null
    let bestHits = 0
    for (const p of pts) {
      const id = Number(p.id)
      if (!id || shown.has(id)) continue
      const text = String(p.text || '') + String(p.title || '')
      let hits = 0
      for (const g of bigrams) if (text.includes(g)) hits++
      if (hits > bestHits && hits >= 2) { bestHits = hits; best = p }
    }
    if (!best) return { line: '', at: last }
    if (String(best.title || '').length < 2) return { line: '', at: last }
    return {
      line: '\n（你提的这个，让我想起另一件：' + String(best.title).slice(0, 24) + '。要问就问。）',
      at: now,
    }
  } catch {
    return { line: '', at: Number(lastAt) || 0 }
  }
}
