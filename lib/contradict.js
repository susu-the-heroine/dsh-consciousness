/**
 * 冲突判定：一句话和旧话打架，得标出来
 * ==================================
 * 现在的冲突只认"事实键"（he.weight 这种）。日常事没键——
 * 「我不吃辣」和「我昨天吃了爆辣火锅」两条都留着，谁也不提谁。
 * 将来问"他吃辣吗"，翻出两条自相矛盾的。
 *
 * 这层的原则：
 *   1. **只标，不改、不删**。两条都留着，等他自己说清哪条算。
 *   2. 宁可漏，不可乱标。乱标会让"冲突"两个字贬值。
 *   3. 判据简单到能解释：同一件事的关键字重了，一条是否定、一条不是。
 */

/** 太常见的字，不参与"是不是同一件事" */
const STOP = new Set(
  ('的了是我你他她它在有和就不都很也这那个么啊吧呢嘛呗一上下里外中把被给对让还再又才只没别吧吗嘛哦'
    // 虚词也算噪声：「不能吃辣」「不太能吃辣」「吃不了辣」其实是同一件事
    + '能会太想该要需长得着过起去来说做搞弄').split(''),
)

/**
 * 太泛的动词和虚词：它们不能当"这两句在说同一件事"的证据。
 * 起因：实测误报——「自检闭环」那条新记忆被标成跟五条旧记忆"说反话"，
 * 共同字只有"说/我/不"这种，满篇都是，等于谁都能撞上。
 * 但"吃、喝、抽、辣、烟、酒"这类不能排除，它们才是真正指向同一件事的字。
 */
const GENERIC = new Set('说做看想会能给让去来要得着过起下上出进拿打到成开用打发弄搞叫问答觉知道是我你他她它了的不没别'.split(''))

/** 否定词 */
const NEG = /不|没|别|甭|从不|从来|再也|并不/

/** 取内容字（去掉标点、数字、停用字） */
export function contentChars(text) {
  const s = String(text || '').replace(/[^\u4e00-\u9fa5]/g, '')
  const out = new Set()
  for (const ch of s) {
    if (STOP.has(ch)) continue
    out.add(ch)
  }
  return out
}

export function hasNegation(text) {
  return NEG.test(String(text || ''))
}

/**
 * 两条记忆是不是在说同一件事、但结论相反。
 * 返回 { conflict, shared: [...], why }
 */
export function contradicts(a, b) {
  const A = contentChars(a)
  const B = contentChars(b)
  const shared = []
  for (const ch of A) if (B.has(ch) && !GENERIC.has(ch)) shared.push(ch)
  if (shared.length < 2) return { conflict: false, shared, why: '共同内容字不够（泛字不算）' }

  const na = hasNegation(a)
  const nb = hasNegation(b)
  if (na === nb) return { conflict: false, shared, why: '否定一侧相同' }

  // 两条都太长时，主题容易被扯散，只在共同字占比够高时才判
  const ratio = shared.length / Math.min(A.size, B.size)
  // 门槛 0.28：实测「我不吃辣，一点辣都受不了」vs「我昨天吃了爆辣火锅，辣得直冒汗」
  // 共同字只有「吃辣」，占比 0.33——按 0.34 会漏。0.28 能收进来，负例测试仍然全过。
  if (ratio < 0.28) return { conflict: false, shared, why: '共同字占比低（' + ratio.toFixed(2) + '）' }

  return {
    conflict: true,
    shared,
    why: '同一件事，一条否定一条肯定（共同字：' + shared.join('') + '）',
  }
}
