/**
 * 数值归一
 * ========
 *
 * 他说「一万三」，库里存的是「11000」；问「两万播放」，存的是「2 万」。
 * 字面匹配不认识这一步，得先把同一个数的几种写法都摆出来。
 *
 * 只做数字：不做单位换算、不猜货币，也不动问句原意。
 */

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 }

/** 把「一万三」「两万」「三千五」这类读法换算成阿拉伯数字；认不出就返回 null */
export function chineseToNumber(s) {
  const str = String(s || '').trim()
  if (!str) return null
  if (/^\d+$/.test(str)) return Number(str)
  let total = 0
  let section = 0
  let digit = 0
  let seen = false
  let lastUnit = 0
  // 2026-11-20：「一万零三」是一万零三，不是一万三。中间那个「零」就是位缺，
  // 尾巴上的单字不能再按上一级的十分之一放大。
  let zeroGap = false
  for (const ch of str) {
    if (ch === '零' || ch === '〇') { zeroGap = true; digit = 0; seen = true; continue }
    if (DIGIT[ch] !== undefined) { digit = DIGIT[ch]; seen = true; continue }
    if (UNIT[ch] !== undefined) {
      const u = UNIT[ch]
      if (u >= 10000) {
        section = (section + digit) || 1
        total += section * u
        section = 0
      } else {
        section += (digit || 1) * u
      }
      lastUnit = u
      digit = 0
      seen = true
      continue
    }
    return null
  }
  if (!seen) return null
  // 「三千五」是 3500、「五百二」是 520：尾巴那个单字要按上一级的十分之一算
  let tail = digit
  if (tail > 0 && lastUnit >= 10 && !zeroGap) tail *= lastUnit / 10
  return total + section + tail
}

/** 从一句话里挑出数字读法，给出它可能的写法 */
export function numberForms(text) {
  const out = new Set()
  const s = String(text || '')
  const re = /[零〇一二两三四五六七八九十百千万亿]{2,}/g
  // 2026-11-21：「一百多万」以前只抠到「一百」，当成 100 送出去——差四个数量级。
  // 后面跟着「多、余、几、来」是把数说虚了，我不猜，宁可这一处不出数。
  for (const mm of s.matchAll(re)) {
    const m = mm[0]
    const after = s[mm.index + m.length] || ''
    // 注意：空串会被 includes 认成「包含」——句子末尾那一处必须先挡掉，否则全被跳过。
    if (after && '多余几来'.includes(after)) continue
    const n = chineseToNumber(m)
    if (!Number.isFinite(n) || n <= 0) continue
    out.add(String(n))
    if (n >= 10000 && n % 1000 === 0) out.add(String(n / 1000) + '千')
    if (n >= 10000 && n % 10000 === 0) out.add(String(n / 10000) + '万')
  }
  // 阿拉伯数字带「万/千」的，也补一个纯数字
  for (const m of s.match(/(\d+(?:\.\d+)?)\s*(万|千|亿)/g) || []) {
    const unit = m.slice(-1)
    const base = Number(m.slice(0, -1))
    if (!Number.isFinite(base)) continue
    out.add(String(Math.round(base * (UNIT[unit] || 1))))
  }
  return [...out]
}
