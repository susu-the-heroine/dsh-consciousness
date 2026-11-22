/**
 * 拼音双通道（清单第 17 件，2026-11-16）
 * ------------------------------------------------------------
 * 治的是错别字和同音词：问「苏苏侠」写成「酥酥侠」、或者直接打「ssx」，
 * 字面这条路全撞不上，向量又不认这种差异——同音召回实测能从 0.46 拉到 0.90。
 *
 * 规矩（清单写死的）：
 *   · 别先纠错再检索——模型纠错精度只有 26%，越纠越歪。
 *   · 查询先跑字面，字面头名 >= 0.8 就不走这条道；只有字面不行才轮到拼音。
 *
 * 三条道（查询侧和条目侧都生成，互相撞）：
 *   · 全拼串：susuxia
 *   · 首字母串：ssx
 *   · 无序 bigram：su|su、su|xia、su|xia …… 顺序无关，治「xia su」这种倒装
 *
 * 数据：lib/pinyin-map.js，从 pinyin-data（MIT）生成，
 *       只取基本区汉字的第一音、去声调，共 20924 字。
 */
import PY from './pinyin-map.js'

const CJK = /[\u4E00-\u9FFF]/

export const hasCJK = (s) => CJK.test(String(s || ''))

/** 汉字串 -> 全拼（无分隔）。非汉字原样保留，方便中英混合。 */
export function pyFull (str) {
  let out = ''
  for (const ch of String(str || '')) {
    out += PY[ch] || (/[a-zA-Z0-9]/.test(ch) ? ch.toLowerCase() : '')
  }
  return out
}

/** 汉字串 -> 首字母串。非汉字字母原样保留。 */
export function pyInitials (str) {
  let out = ''
  for (const ch of String(str || '')) {
    const syl = PY[ch]
    if (syl) out += syl[0]
    else if (/[a-zA-Z0-9]/.test(ch)) out += ch.toLowerCase()
  }
  return out
}

/** 汉字串 -> 音节数组（供 bigram 用）。 */
export function pySyllables (str) {
  const out = []
  for (const ch of String(str || '')) {
    const syl = PY[ch]
    if (syl) out.push(syl)
  }
  return out
}

/** 无序 bigram 集合：'su|xia' 这种键，顺序无关。 */
export function pyBigramSet (str) {
  const syls = pySyllables(str)
  const set = new Set()
  for (let i = 0; i < syls.length; i++) {
    for (let j = i + 1; j < syls.length && j < i + 3; j++) {
      set.add(syls[i] <= syls[j] ? syls[i] + '|' + syls[j] : syls[j] + '|' + syls[i])
    }
  }
  return set
}

/**
 * 一条候选取不取，以及取多狠。
 * 返回 0..1；0 表示这条道没撞上。
 * qSide 是查询侧预处理好的 {full, initials, grams}。
 * 条目侧每次现算并挂在点上缓存（_py），省的每条查询都重算全文拼音。
 */
const _PYC = new WeakMap()

export function pinyinRel (qSide, point, hayLimit) {
  const hay = String((point && point.title) || '') + String((point && point.alias) || '') +
    String((point && point.text) || '').slice(0, hayLimit || 150)
  // 2026-11-20：原来把缓存挂在条目对象上（point._py）。可条目会被整块写回 data.json——
  // 一次检索就把拼音全串和大堆 bigram 固化进库里，体积白涨；而且 Set 存成 {}，
  // 下次读回来 .has 不是函数。改成模块内 WeakMap，只活在内存里。
  let py = point ? _PYC.get(point) : null
  if (!py || py.hay !== hay) {
    py = { hay, full: pyFull(hay), initials: pyInitials(hay), grams: pyBigramSet(hay) }
    if (point) { try { _PYC.set(point, py) } catch {} }
  }
  // 全拼整串撞上：最硬。
  if (qSide.full.length >= 4 && py.full.includes(qSide.full)) return 1
  // 首字母整串撞上：次硬。短查询（2-3 字母）也认，但要够长才不撒网。
  if (qSide.initials.length >= 2 && py.initials.includes(qSide.initials)) {
    return qSide.initials.length >= 4 ? 0.85 : 0.7
  }
  // bigram 重叠：治倒装和错一半的音。
  if (qSide.grams.size >= 2) {
    let hit = 0
    for (const g of qSide.grams) if (py.grams.has(g)) hit++
    const ratio = hit / qSide.grams.size
    if (ratio >= 0.5) return 0.4 + ratio * 0.5
  }
  return 0
}

/**
 * 查询侧预处理一次。
 * 查询本身是汉字 → 转拼音再撞；查询是拼音字母（ssx）→ 直接拿原串撞。
 */
export function pinyinQuery (query) {
  const q = String(query || '').trim()
  if (hasCJK(q)) {
    const full = pyFull(q)
    const initials = pyInitials(q)
    return { full, initials, grams: pyBigramSet(q) }
  }
  const low = q.toLowerCase().replace(/[^a-z0-9]/g, '')
  const grams = new Set()
  for (let i = 0; i + 2 <= low.length; i++) {
    const a = low.slice(i, i + 2)
    grams.add(a)
  }
  return { full: low, initials: low, grams }
}
