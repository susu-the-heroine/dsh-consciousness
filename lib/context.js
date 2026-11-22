/**
 * 指着说：把「那个东西」接回上一句提到的那件
 * ======================================
 *
 * 人说话靠上下文——「那个东西后来咋了」，指的是上一句那个东西。
 * 这里只做一件事：从上一句里挑出最像「那件东西」的名词，替掉问句里的指代词。
 * 挑不到就原样返回，让上层照旧找——宁可不接，不许乱接。
 */

const PLACEHOLDER = /(那个东西|那东西|那个|那件事|那事儿|那事|它|这件东西|这件事)/

/** 从一句话里挑「最像东西」的那个词：带量词的名词优先，越长越优先。 */
export function pickReferent(text) {
  const s = String(text || '')
  if (!s) return ''
  // 2026-11-21：原来一口气抓六个汉字，把动词也抓进来——「那台旧相机被偷了」整串都当成了那件东西，
  // 接到问句里变成「那台旧相机被偷了后来咋样了」。改成遇到动词/虚词就截断，只留那件东西本身。
  const CUT = /[被说把给在送修偷摔忘换借卖丢要很太都也还就了的是和与跟对从到]/
  const withMeasure = [...s.matchAll(/(那|这)\s*[辆台把只盆副盏口张条件套间本双块根片]?\s*[\u4e00-\u9fa5]{1,6}/g)]
    .map((m) => m[0].split(CUT)[0].trim())
  const cands = withMeasure.filter((x) => x.length >= 3)
  if (!cands.length) return ''
  // 只有「唯一」才敢认：上一句里有两样东西时，人也不确定指的是哪个。
  // 研究给的数字：弃权式规则的公开结果是 92% 精确 / 64% 召回（CogNIAC）——
  // 宁可弃权，也不乱认。2026-11-17 夜。
  const uniq = [...new Set(cands)]
  if (uniq.length > 1) return ''
  return uniq[0]
}

/** 把问句里的指代词换成上一句的那件东西。挑不到就原样返回。 */
export function resolveRef(query, prev) {
  try {
    const q = String(query || '')
    if (!q || !PLACEHOLDER.test(q)) return q
    const ref = pickReferent(prev)
    if (!ref) return q
    return q.replace(PLACEHOLDER, ref)
  } catch {
    return String(query || '')
  }
}
