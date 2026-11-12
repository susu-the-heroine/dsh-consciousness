/**
 * 重排
 * ====
 *
 * 检索出来的候选已经排过一次，这里再排一次。目标只有一个：
 * 把「像但不对」的压下去，把「确实对但排低了」的抬上来。
 *
 * 为什么不用模型：本机没装重排模型，下载要几个 G，装了还得吃 CPU。
 * 先用规则把能算的算准——这一版不解决语义，只解决排序。
 *
 * 开关：高档以上才跑（low 档就是要省，别为排序多花力气）。
 * 2026-11-11 深夜。
 */
import { qualityRank } from './quality.js'

/** 去掉标点和空白，只留字 */
export function flat(s) {
  return String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()【】]/g, '')
}

// 问句里出现这些，说明他要的是「当时那句话」，不是概述
const WANT_QUOTE = /原话|说过|怎么说的|那句|咋说的|什么语气/
// 问句里出现这些，说明他在问某一天
const WANT_DAY = /那天|昨天|前天|当时|那会儿|上次|那年/

const pts = (s) => [...String(s || '')]

/**
 * 给一批候选重新排。
 * @param {Array} scored  [{p, score, why, ...}]
 * @param {string} query  原问句
 * @returns {Array} 新数组，不改原对象里的东西（只加 why）
 */
export function rerank(scored, query) {
  const list = Array.isArray(scored) ? scored.slice() : []
  if (!list.length) return list
  // 低档不跑：低档的设计目标就是省
  if (qualityRank() < 2) return list

  const qf = flat(query)
  const wantQuote = WANT_QUOTE.test(String(query || ''))
  const wantDay = WANT_DAY.test(String(query || ''))
  const qChars = new Set(pts(qf))
  const now = Date.now()

  const scoredList = list.map((x, i) => {
    const p = x.p || {}
    let add = 0
    const why = []

    // 一、整句字面命中：这条最硬，直接抬到最前
    const hay = flat(p.title) + flat(p.text)
    if (qf.length >= 6 && hay.includes(qf)) {
      add += 0.6
      why.push('整句')
    }

    // 二、标题命中的字数占比：标题对得上，比正文里蹭到一个词更可信
    const tf = flat(p.title)
    if (tf && qf.length >= 4) {
      let hitN = 0
      for (const ch of qChars) if (tf.includes(ch)) hitN++
      const ratio = hitN / Math.max(1, qChars.size)
      if (ratio >= 0.5) {
        add += 0.2 * ratio
        why.push('标题' + ratio.toFixed(2))
      }
    }

    // 三、他要原话，就给带对话的那几条
    if (wantQuote) {
      const hasQuote = /[「『""']/.test(String(p.text || ''))
      if (hasQuote) { add += 0.15; why.push('带原话') }
    }

    // 四、他问"那天"，近期的事更可能是他要的那天
    if (wantDay) {
      const t = Number(p.born) || Number(p.lastSeen) || 0
      if (t) {
        const days = (now - t) / 86400000
        if (days <= 3) { add += 0.12; why.push('近三天') }
        else if (days <= 30) { add += 0.05; why.push('本月') }
      }
    }

    // 合成条是二手的：它由别的记忆拼出来，不该压过那些原来的一条条。
    // 实测：问「检索这条怎么修的」，合成那条顶掉了原件。2026-11-11 深夜。
    if (/^〔合成〕|^\[合成\]/.test(String(p.title || ''))) {
      add -= 0.12
      why.push('合成降权')
    }

    if (add) {
      x.score = Number(x.score || 0) + add
      x.why = Array.isArray(x.why) ? [...x.why, '重排+' + add.toFixed(2)] : ['重排+' + add.toFixed(2)]
    }
    return { x, i, s: Number(x.score) || 0 }
  })

  // 分数高的在前；同分保持原顺序（稳定性比随机好）
  scoredList.sort((a, b) => (b.s - a.s) || (a.i - b.i))
  return scoredList.map((o) => o.x)
}
