/**
 * 你说的是哪一件
 * ==============
 *
 * 一致性反证逼出来的：同一个人同一件事有好几件时，「他那个被偷了的东西」没有唯一答案。
 * 但「问句短就反问」不合理——人不会为每句话都停下来确认。
 *
 * 人的做法：先猜最可能的那件，顺口带一句「我说的是X，不是那件吧」；
 * 只有两件一样新、猜错就要改结论的时候，才真停下来问。
 */

const EVENTS = '被偷了|修好了|送人了|摔坏了|忘在车上|一直没动|换了新的|借出去了|丢了|坏了'
const EVENT_ONLY = new RegExp('^(.{1,6}?)(?:那个|那件|那台|那只|那把|那口|的)?(' + EVENTS + ')的东西')

function objectsOf(p) {
  const t = String(p.title || '')
  const m = t.match(/(?:那|这)[辆台把只盆副盏口张条件套间本双块根片]([\u4e00-\u9fa5]{2,6})/)
  return m ? m[1] : ''
}

function stamp(p) {
  return Number(p.recalledAt || p.lastRecalledAt || p.born || 0)
}

/**
 * @returns {{kind:'none'|'ask'|'guess', text:string, pick?:object}}
 */
export function ambiguityAsk(query, points) {
  try {
    const q = String(query || '').replace(/\s+/g, '')
    const m = q.match(EVENT_ONLY)
    if (!m) return { kind: 'none', text: '' }
    const owner = m[1]
    const ev = m[2]
    const hits = (Array.isArray(points) ? points : []).filter((item) => {
      const p = item && item.p ? item.p : item
      if (!p || p.dead) return false
      const t = String(p.title || '')
      return t.includes(owner) && t.includes(ev)
    })
    if (hits.length < 2) return { kind: 'none', text: '' }
    const names = hits.map((item) => objectsOf(item && item.p ? item.p : item)).filter(Boolean)
    if (new Set(names).size < 2) return { kind: 'none', text: '' }

    const sorted = hits.slice().sort((a, b) => stamp(b.p || b) - stamp(a.p || a))
    const top = sorted[0]
    const second = sorted[1]
    const gapDays = (stamp(top.p || top) - stamp(second.p || second)) / 86400000
    const topName = objectsOf(top.p || top)
    const secondName = objectsOf(second.p || second)

    // 两件一样新：猜哪件都可能错，停下问。
    if (!(gapDays >= 3)) {
      return {
        kind: 'ask',
        text: '你说的这个，' + owner + '名下有两件对得上：' + names.slice(0, 4).join('、') + '。\n问哪件？',
      }
    }
    // 一件明显更新：先答那件，把其余的顺手报出来（三件以上就报两件 + 总数）。
    const others = names.filter((n) => n !== topName)
    const more = hits.length > 2
      ? // 2026-11-21：这句原来写「还有 N 件」，N 是命中总数（含已经答过的那件），
      // 读起来像「还有 N 件没答」，可下面只列两件。改成「一共」。
      '一共 ' + hits.length + ' 件，先说两件：' + others.slice(0, 2).join('、')
      : '还有一件「' + secondName + '」'
    return {
      kind: 'guess',
      pick: top.p || top,
      text: '（我按「' + topName + '」答的。' + owner + '那儿' + more + '——要是问那件，说一声。）\n',
    }
  } catch {
    return { kind: 'none', text: '' }
  }
}
