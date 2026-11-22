/**
 * 显式的缺口：你说的那件东西，我没记过
 * ==================================
 *
 * 被「配对评测」逼出来的：反例把物件换成库里没有的（那台老式打字机），
 * 以前它会因为「老周」这两个字命中，拿别人的事来答。
 *
 * 但也不能一刀切——打错一个字是手滑，不是没这件东西。
 * 所以要先有「物件名册」：
 *   - 名册只从条目标题、别名里抽（不拿正文整段滑窗，那会把句子当东西）
 *   - 问句里的物件词先查名册；查不到再看「只差一个字」
 *   - 两样都不是，才说没记过
 */

// 2026-11-21：量词表原来只有十几个，「那架钢琴」「那艘船」「那棵榕树」「那座桥」「那匹老马」
// 一律抽不出物件，于是这些问题不会被判成「没记过」，照样拿不相干的事来答。补常见的。
const MEASURE = '辆台把只盆副盏口张条件套间本双块根片架艘座棵匹头尊枚栋面顶'
// 问句要有「问法」在后头；条目标题没有，所以用两套。
const OBJ_Q = new RegExp('(?:那|这)\\s*([' + MEASURE + '])\\s*([\\u4e00-\\u9fa5]{1,8}?)(?=后来|咋样|怎么样|怎么|如何|呢|吗|来着|$|[，,。！？!?])', 'g')
const OBJ_T = new RegExp('(?:那|这)\\s*([' + MEASURE + '])\\s*([\\u4e00-\\u9fa5]{1,8})', 'g')

/** 物件词尾巴常粘着动词：「菜忘在车上」——切在这些字前面。 */
const VERB_CUT = /[了在送换修摔偷借丢扔卖买给造做弄装被坏没得着过出进上下走开掉]/

function cutHead(raw) {
  const s = String(raw || '')
  const i = s.search(VERB_CUT)
  return (i > 0 ? s.slice(0, i) : s).trim()
}

/** 从条目里抽物件名册。只认标题和别名，不认正文。 */
export function buildLexicon(points) {
  const out = new Set()
  for (const item of Array.isArray(points) ? points : []) {
    const p = item && item.p ? item.p : item
    if (!p) continue
    for (const field of [p.title, p.alias]) {
      const t = String(field || '')
      if (!t) continue
      OBJ_T.lastIndex = 0
      let m
      while ((m = OBJ_T.exec(t))) {
        const head = cutHead(m[2])
        if ([...head].length >= 2 && [...head].length <= 6 && !head.includes('的')) out.add(head)
      }
    }
  }
  return out
}

/** 从问句里挑出指名道姓的物件（同样切掉动词尾巴）。 */
export function askedObjects(query) {
  const q = String(query || '')
  const out = []
  OBJ_Q.lastIndex = 0
  let m
  while ((m = OBJ_Q.exec(q))) {
    const head = cutHead(m[2])
    if ([...head].length >= 2 && [...head].length <= 6 && !head.includes('的')) out.push(head)
  }
  return [...new Set(out)]
}

function nearOne(a, b) {
  const x = String(a || '')
  const y = String(b || '')
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

function nearestName(head, lexicon) {
  for (const name of lexicon) if (nearOne(head, name)) return name
  return ''
}

export function gapRefusal(query, points, textOf) {
  const q = String(query || '')
  try {
    const objs = askedObjects(query)
    if (!objs.length) return ''
    const arr = Array.isArray(points) ? points : []
    if (!arr.length) return ''
    const lexicon = buildLexicon(arr)
    if (!lexicon.size) return ''
    const get = typeof textOf === 'function' ? textOf : null
    const allText = get ? arr.map(get).join('\n') : ''
    for (const o of objs) {
      if (lexicon.has(o)) continue
      if (allText && allText.includes(o)) continue
      // 名册里有「只差一个字」的——分两种：
      // 主人也对得上：那是手滑，照常去找，别打断。
      // 主人对不上：那不是手滑，是两样东西，反问一句，不替人改。
      const near = nearestName(o, lexicon)
      if (near) {
        const owner = q.indexOf('那') > 0 ? q.slice(0, q.indexOf('那')).replace(new RegExp('[' + MEASURE + '把]$'), '') : ''
        const sameOwner = owner && arr.some((item) => {
          const p0 = item && item.p ? item.p : item
          const t = String((p0 && p0.title) || '')
          return t.includes(near) && t.includes(owner)
        })
        if (!sameOwner) {
          return '你说的「' + o + '」，我这儿记的是「' + near + '」——问的是这个吗？\n（名字差一个字，我不敢替你改。）'
        }
        // 2026-11-20：主人也对得上＝手滑，按注释该照常去找，不该拦。
        // 原来这里没 continue，一路掉到下面那句「我没记过」——手滑也被判成没这件东西。
        continue
      }
      return '你说的「' + o + '」我没记过。\n（不是想不起来——是我这儿确实没这一件。要是你记错了说法，换个叫法再问一次。）'
    }
    return ''
  } catch {
    return ''
  }
}
