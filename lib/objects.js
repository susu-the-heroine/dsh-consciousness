/**
 * 物件名册
 * ========
 *
 * 光靠「差一个字」判手滑会出事：铜锅和铁锅只差一个字，可那是两样东西。
 * 所以得先有册子——这条海里有哪几样东西，叫得出名字。
 *
 * 三条规矩：
 *   1. 物件名至少两个字。中文里没有一字的东西（除了「锅」这种口语），
 *      切出来只剩一个字的，说明动词切早了，往后再借一个字。
 *   2. 册子从标题、别名、正文都收——正文里才写着「菜刀」。
 *   3. 判手滑必须主人也对得上：同一个人的同一件事，才是打错字。
 */

const MEASURE = '辆台把只盆副盏口张条件套间本双块根片'
const MEASURE_SET = new Set(MEASURE.split(''))

// 动词、助词、方位——物件名到这儿就该断
const CUT = /[了在送换修摔偷借丢扔卖买给造做弄装被坏没得着过出进上下走开掉有是用让叫把说看想忘记拿放存]/


const PHRASE = new RegExp('(?:那|这)\\s*([' + MEASURE + '])\\s*([\\u4e00-\\u9fa5]{1,8})', 'g')

/** 切出物件名：至少两个字。切出来只有一个字，就往后借一个。 */
export function cutObject(raw) {
  const s = String(raw || '')
  if (!s) return ''
  const i = s.search(CUT)
  let head = i > 0 ? s.slice(0, i) : s
  if ([...head].length < 2) {
    // 动词太靠前：往后借到两个字（「斗鱼」「菜刀」「收音机」这种）
    const want = Math.min([...s].length, 3)
    head = s.slice(0, want)
    const j = head.search(CUT)
    if (j >= 2) head = head.slice(0, j)
  }
  return head.trim()
}

/** 从一段话里抽所有「那台X」式的物件名。 */
export function objectsIn(text) {
  const t = String(text || '')
  const out = []
  PHRASE.lastIndex = 0
  let m
  while ((m = PHRASE.exec(t))) {
    const head = cutObject(m[2])
    if ([...head].length >= 2 && [...head].length <= 6 && !head.includes('的')) out.push(head)
  }
  return [...new Set(out)]
}

/** 建册子：标题、别名、正文都收。返回 Map<名字, 条目数>。 */
export function buildLexicon(points) {
  const lex = new Map()
  for (const item of Array.isArray(points) ? points : []) {
    const p = item && item.p ? item.p : item
    if (!p || p.dead) continue
    const seen = new Set()
    for (const field of [p.title, p.alias, p.text]) {
      for (const name of objectsIn(field)) {
        if (seen.has(name)) continue
        seen.add(name)
        lex.set(name, (lex.get(name) || 0) + 1)
      }
    }
  }
  return lex
}

/** 名字像不像打错一个：等长换一个字，或差一个字。 */
export function nearOne(a, b) {
  const x = String(a || '')
  const y = String(b || '')
  if (x === y) return true
  const dx = Math.abs(x.length - y.length)
  if (dx > 1) return false
  if (dx === 0) {
    let diff = 0
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++
    return diff <= 1
  }
  const short = x.length < y.length ? x : y
  const long = x.length < y.length ? y : x
  let i = 0
  let j = 0
  let skip = 0
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++ } else { skip++; j++; if (skip > 1) return false }
  }
  return true
}

/** 册子里最像它的名字。 */
export function nearest(name, lex) {
  const keys = lex instanceof Map ? [...lex.keys()] : [...(lex || [])]
  let best = ''
  for (const k of keys) if (nearOne(name, k)) { if (!best || k.length > best.length) best = k }
  return best
}

/** 问句里的物件名有没有打错；错就修，并给一句说明。 */
export function repairQuery(query, lex) {
  const q = String(query || '')
  let out = q
  const fixed = []
  for (const o of objectsIn(q)) {
    if (lex.has(o)) continue
    const near = nearest(o, lex)
    // 只补「少打一个字」的——多打一个字、换一个字都可能换出另一样东西（铜锅/铁锅），那种要问不要猜。
    const deletionOnly = near && near.length === o.length + 1
    if (deletionOnly) {
      out = out.split(o).join(near)
      fixed.push(o + '→' + near)
    }
  }
  if (!fixed.length) return { query: q, note: '' }
  const _say = fixed.join('、').split('→').join(' 当成 ')
  return { query: out, note: '（名字少打了一个字，我按册子里的叫法找的：' + _say + '）' }
}

export { MEASURE, MEASURE_SET }
