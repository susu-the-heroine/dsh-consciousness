/**
 * 你问的是哪一样
 * ==============
 *
 *   time   什么时候、哪一天、几号
 *   result 后来怎么了、最后怎么样、现在呢
 *   exist  有没有、是不是、记不记得
 *   ''     判不准就归普通，不许硬判
 *
 * 判出来只用来改排序，不改「有没有」。
 */

export function classifyAsk(query) {
  const q = String(query || '')
  if (!q) return ''
  // 2026-11-21：他嘴上说的是「啥时候」，这条原来只认「什么时候」，于是最常见的问法被判成普通，
  // 该抬有日子的那条没抬。多认几个口语说法。
  if (/什么时候|啥时候|啥时候儿|几时|多会儿|哪天|几号|哪年|哪一年|多久以前|多长时间|几月/.test(q)) return 'time'
  if (/后来|最后|结果|现在呢|现在怎么样|现在咋样|咋样了|怎么处理的|怎么处理了|怎么样了/.test(q)) return 'result'
  if (/有没有|是不是|记不记得|还记着|有记过|记过吗|有过吗/.test(q)) return 'exist'
  return ''
}

/** 正文里有没有日子：写得出来才算。 */
export function hasDate(text) {
  const t = String(text || '')
  return /\d{4}\s*[-年]|\d{1,2}\s*[月日]|[零一二三四五六七八九十]+\s*(点|号|月|日|年)/.test(t)
}

/** 正文里有没有「后来怎么样」那种词。 */
export function hasResultWord(text) {
  return /后来|最后|结果|现在|之后|过了两天|第二天/.test(String(text || ''))
}

/**
 * 只改顺序：按问的类型，把「答得上」的往前挪一点。
 * 只加分不减分，幅度压在 0.08 以内——翻得动名次，翻不动本来就没戏的。
 */
export function rerankByAsk(list, askType, textOf) {
  const arr = Array.isArray(list) ? list : []
  const t = String(askType || '')
  if (!t || t === 'exist') return arr
  const get = typeof textOf === 'function' ? textOf : (x) => String((x && x.p && x.p.text) || '')
  for (const x of arr) {
    if (!x || typeof x.score !== 'number') continue
    const tx = get(x)
    if (t === 'time' && hasDate(tx)) x.score += 0.06
    if (t === 'result' && hasResultWord(tx)) x.score += 0.06
  }
  return arr
}
