/**
 * 并错了要喊一声
 * ==============
 *
 * 合并没有错——同一件事写两遍，本就该并。
 * 错的是把两件事并成一条还不出声。所以：并之前先量一句像不像，
 * 像得不够就带一句话出来，让人自己看一眼。
 */

/** 白话相似度：两字滑窗重合率，够用就行，不追求准。 */
export function roughSim(a, b) {
  const s1 = String(a || '').replace(/\s+/g, '')
  const s2 = String(b || '').replace(/\s+/g, '')
  if (!s1 || !s2) return 0
  const grams = (s) => {
    const m = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) || 0) + 1)
    }
    return m
  }
  const g1 = grams(s1)
  const g2 = grams(s2)
  let hit = 0
  for (const [k, v] of g1) hit += Math.min(v, g2.get(k) || 0)
  // 分母用「长的那条」：多写一段就算不一样，不能被短的遮住。
  const denom = Math.max(1, Math.max(s1.length, s2.length) - 1)
  return Math.min(1, hit / denom)
}

/**
 * 合并之后要不要出声。
 * 像到九成七以上：一句话不说（本来就该并）。
 * 六成到九成七：说一句「说法不太一样，你看一眼」。
 * 不到六成：说「很可能不是一件事，要拆就说一声」。
 *
 * 2026-11-21：原来注释写「九成以上」，实现是九成七——两边差了一截，按实现改。
 */
export function mergeNote(inTitle, inText, oldTitle, oldText) {
  try {
    if (!inTitle && !inText && !oldTitle && !oldText) return ''
    // 看正文，不看标题：标题一样但正文不一样，正是最容易并错的那种。
    const s = (inText && oldText) ? roughSim(inText, oldText) : roughSim(inTitle, oldTitle)
    // 2026-11-21：本来说好「看正文，不看标题」，可只有一边有正文时它会悄悄比起标题，
    // 标题一样就一声不响——正是注释里怕的那种「并错了还不出声」。这档单独说一句。
    const onlyOneText = (!inText) !== (!oldText)
    if (onlyOneText && s >= 0.97) {
      return '\n  （跟先前那条并一块了，可只有一边写了正文，我只比了标题——你扫一眼，不对就说拆开）'
    }
    if (s >= 0.97) return ''
    if (s >= 0.6) return '\n  （跟上回那条并一块了，可两句说法不太一样——你扫一眼，不对就说拆开）'
    return '\n  （跟上回那条并一块了，可这两件差得有点远——多半不是一件事，要拆就说一声）'
  } catch {
    return ''
  }
}
