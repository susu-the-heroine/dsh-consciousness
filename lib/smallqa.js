/**
 * 小题库：把三百多题按问法切三档
 * ==============================
 *
 * 一、指代题：问的是「那个东西/那件事/这个人」，考能不能接上前文。
 * 二、否定题：句子里有「没/不/别/不是」，考会不会把反面当正面。
 * 三、长问句：二十八字以上，考拆不拆得开。
 *
 * 每档各取二十题，用来盯「改了之后这三类有没有掉」。
 * 只做切题和统计，不跑检索——跑是脚本的事。
 */

const REF = /那个|那件|那次|这个人|那回|他说的|她说的|前面说过|刚才说|他的|她的|这事儿|这件事/
const NEG = /没|不是|别|从来没|不再|不记得|没有/
const MIN_LONG = 28

export function pickCases(cases, n = 20) {
  // 2026-11-20：原来只判「转成数字是不是有限」——空字符串会被转成零，照样当有效题收进来，
  // 于是「该翻到 0 号」这种不存在的题混进统计，分母白胖。先判有没有，再判是不是数。
  const all = (Array.isArray(cases) ? cases : []).filter((c) => {
    if (!c || !c.q) return false
    if (c.want === undefined || c.want === null || c.want === '') return false
    return Number.isFinite(Number(c.want))
  })
  const used = new Set()
  const take = (pred) => {
    const out = []
    for (const c of all) {
      if (out.length >= n) break
      const key = String(c.q)
      if (used.has(key)) continue
      if (!pred(c)) continue
      used.add(key)
      out.push(c)
    }
    return out
  }
  const ref = take((c) => REF.test(String(c.q)))
  const neg = take((c) => NEG.test(String(c.q)) && !REF.test(String(c.q)))
  const long = take((c) => String(c.q).length >= MIN_LONG)
  return { ref, neg, long }
}

/** 一批结果算 top1/top3：rank 是想要的那条在结果里的位次（0 = 没进） */
export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return { n: 0, top1: 0, top3: 0 }
  const top1 = list.filter((r) => Number(r.rank) === 1).length
  const top3 = list.filter((r) => Number(r.rank) >= 1 && Number(r.rank) <= 3).length
  return {
    n: list.length,
    top1: Math.round((top1 / list.length) * 10000) / 100,
    top3: Math.round((top3 / list.length) * 10000) / 100,
  }
}

/** 地板：每档各减两分，低于这个就挡 */
export function floorsOf(sets) {
  const out = {}
  for (const [k, s] of Object.entries(sets || {})) {
    out[k] = { top1: Math.max(0, s.top1 - 2), top3: Math.max(0, s.top3 - 2) }
  }
  return out
}
