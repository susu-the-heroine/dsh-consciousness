/**
 * 改口裁决
 * ========
 *
 * 2026-11-18 加。之前只给被盖过的那条挂个牌子，顺序不动——
 * 问「现在」时旧的还能抢头名，问「当时」时新的又盖住旧的，两头都别扭。
 *
 * 这里只做一件事：看问的是现在还是当时，给被盖过的那条加分或减分。
 * 规则窄、可解释、错了也只错一名。
 */

const NOW = /现在|如今|目前|最新|现在还|现在改|改成了|改成|后来呢|后来改|眼下/
const PAST = /当时|原来|以前|最早|第一次|原本|当初|那会儿|最早那回/

export function timeIntent(query) {
  const q = String(query || '')
  if (!q) return null
  const now = NOW.test(q)
  const past = PAST.test(q)
  if (now && !past) return 'now'
  if (past && !now) return 'past'
  return null
}

/**
 * 就地调整顺序。返回 { intent, moved }
 * now：被盖过的那条 ×0.55（还它一个「旧说法」的位置）
 * past：被盖过的那条 ×1.25（问当时就该先给当时那版）
 */
export function applyVerdict(scored, query) {
  try {
    const intent = timeIntent(query)
    if (!intent || !Array.isArray(scored) || scored.length < 2) return { intent, moved: 0 }
    const before = scored.map((x) => x.p && x.p.id).join(',')
    let moved = 0
    for (const x of scored) {
      const sup = Number(x.p && x.p.supersededBy) || 0
      const newer = Number(x.p && x.p.supersedes) || 0
      if (!sup && !newer) continue
      // 现在：旧的压下去，顶替它的那条抬上来；当时反过来，只抬旧的
      const k = intent === 'now'
        ? (sup ? 0.55 : 1.35)
        : (sup ? 1.25 : 0.8)
      x.score = (Number(x.score) || 0) * k
      moved++
    }
    if (moved) scored.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    return { intent, moved, changed: before !== scored.map((x) => x.p && x.p.id).join(',') }
  } catch {
    return { intent: null, moved: 0 }
  }
}

export function verdictNote(intent) {
  if (intent === 'now') return '\n（按「现在」排的：改过口的旧版往后放了，你要是问当时的，直说。）'
  if (intent === 'past') return '\n（按「当时」排的：改过口的那版在前，现在的说法在后。）'
  return ''
}
