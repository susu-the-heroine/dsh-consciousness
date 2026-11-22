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
 * 开关（2026-11-20 补全）：高档以上才跑；另外这套规则默认是关的，
 * 要试得显式设 C2_RERANK_RULES=1（实测它会把分数打低，见下面 39 行那段）。
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
 * @returns {Array} 排好的新数组；**里面的条目还是原来那些对象**——
 *   会就地改它的 score、加 why 和 __i（调用方拿的就是同一份，别以为拿到的是副本）。
 */
export function rerank(scored, query) {
  const list = Array.isArray(scored) ? scored.slice() : []
  if (!list.length) return list
  // 低档不跑：低档的设计目标就是省
  if (qualityRank() < 2) return list
  // 2026-11-19：向量修对之后，这套规则重排反而把分数打低（329 题实测 95.1% → 94.5%）。
  // 默认关掉，留着做对照；要试就设 C2_RERANK_RULES=1。
  if (String(process.env.C2_RERANK_RULES || '') !== '1') return list

  const qf = flat(query)
  const wantQuote = WANT_QUOTE.test(String(query || ''))
  const wantDay = WANT_DAY.test(String(query || ''))
  const qChars = new Set(pts(qf))
  const now = Date.now()

  // 只重排头部：最终只出十条以内，给两千条逐条算标题占比是白烧 CPU（2026-11-18 夜）
  const TOPN = Math.max(20, Number(process.env.C2_RERANK_TOPN) || 60)
  const _head = list.slice(0, TOPN).map((x, i) => (x.__i === undefined ? ((x.__i = i), x) : x))
  const scoredList = _head.map((x, i) => {
    const p = x.p || {}
    let add = 0
    const why = []

    // 一、整句字面命中：这条最硬，直接抬到最前
    const hay = flat(p.title) + flat(p.text)
    if (qf.length >= 6 && hay.includes(qf)) {
      add += 0.25
      why.push('整句')
    }

    // 二、标题命中的字数占比：标题对得上，比正文里蹭到一个词更可信
    const tf = flat(p.title)
    if (tf && qf.length >= 4) {
      let hitN = 0
      for (const ch of qChars) if (tf.includes(ch)) hitN++
      const ratio = hitN / Math.max(1, qChars.size)
      if (ratio >= 0.5) {
        add += 0.1 * ratio
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
      // 2026-11-20：上面算了一路的理由（整句/标题/带原话/近三天/合成降权）原来算完就扔，
      // 只留下一个「重排+0.25」。排查的时候看不出是凭什么抬的。把理由一起挂上。
      const tag = '重排+' + add.toFixed(2) + (why.length ? '（' + why.join('、') + '）' : '')
      x.why = Array.isArray(x.why) ? [...x.why, tag] : [tag]
    }
    return { x, i, s: Number(x.score) || 0 }
  })

  // 分数高的在前；同分保持原顺序（稳定性比随机好）
  scoredList.sort((a, b) => (b.s - a.s) || (a.i - b.i))
  return scoredList.map((o) => o.x)
}
