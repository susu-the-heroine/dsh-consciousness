/**
 * 检索日志与标注
 * ==============
 *
 * 每一次 memory_search 落一行，标一次对错再落一行。**只追加，不修改**。
 *
 * 为什么必须有这个：
 *   检索跑了上万次，一次都没记「谁问的、翻出什么、用没用上」。
 *   没有这张表，调常数就是在黑屋里换灯泡——你永远不知道换对了没有。
 *
 * 两种行：
 *   { k: 's', ... }  一次检索
 *   { k: 'j', ... }  一次标注
 *
 * 标注只有两种：hit（翻到了）/ miss（没翻到该有的那条）。
 * 有标注了，recall@k 才真的算得出来——现在没有，所以不算。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { SEARCH_LOG_FILE } from './paths.js'

/** 日志最多留多少行（超出按时间截尾，不删文件） */
const MAX_LINES = 20000

let _seq = 0

/** 这一次检索的编号。带时间戳，重启也不会撞 */
function newId() {
  _seq++
  return `${Date.now().toString(36)}-${_seq}`
}

/**
 * 记一次检索。
 * results 只存前几条的 id / 标题 / 分数，不存正文——日志不该变成第二个数据库。
 */
export function logSearch({ sea, query, tier, limit, results, src, note }) {
  try {
    const id = newId()
    const top = (results || []).slice(0, 8).map((x) => ({
      id: x.id,
      t: String(x.title || '').slice(0, 40),
      s: Math.round((Number(x.score) || 0) * 1000) / 1000,
    }))
    const line = JSON.stringify({
      k: 's',
      id,
      t: Date.now(),
      sea: sea || 'main',
      q: String(query || '').slice(0, 120),
      tier: tier || '',
      n: (results || []).length,
      limit: limit || 0,
      src: src || 'tool',
      note: note || '',
      top,
    })
    appendFileSync(SEARCH_LOG_FILE, line + '\n', 'utf8')
    return id
  } catch {
    return null
  }
}

/**
 * 标一次对错。
 * verdict: 'hit' 翻到了该有的那条 / 'miss' 没翻到 / 'wrong' 翻出来的是错的
 * expectId: 如果知道该翻到哪条，填上——这样能算「排第几」
 */
export function judgeSearch({ logId, verdict, expectId, note }) {
  try {
    const v = String(verdict || '').trim()
    if (!['hit', 'miss', 'wrong', 'good'].includes(v)) return false
    const line = JSON.stringify({
      k: 'j',
      id: String(logId || ''),
      t: Date.now(),
      v: v === 'good' ? 'hit' : v,
      e: expectId ? Number(expectId) : null,
      note: String(note || '').slice(0, 120),
    })
    appendFileSync(SEARCH_LOG_FILE, line + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/** 读最近的日志行解析成对象。超过 MAX_LINES 只管最后那一批 */
export function readLog(limit = 500) {
  try {
    if (!existsSync(SEARCH_LOG_FILE)) return []
    const raw = readFileSync(SEARCH_LOG_FILE, 'utf8')
    let lines = raw.split('\n')
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES)
    const out = []
    for (const ln of lines) {
      if (!ln.trim()) continue
      try {
        out.push(JSON.parse(ln))
      } catch {
        /* 半行忽略 */
      }
    }
    return limit > 0 ? out.slice(-limit) : out
  } catch {
    return []
  }
}

/**
 * 算指标。
 *
 * recall@k —— 有标注的那些检索里，翻到的比例。
 * 这是学术界衡量检索的唯一老实办法：不是「感觉挺准」，是「标了 N 次，中了几次」。
 *
 * 还没有标注的时候，它会如实说「样本不足」，不报一个假的 0% 或 100%。
 */
export function logStats() {
  const rows = readLog(0)
  const searches = new Map()
  const judges = []

  for (const r of rows) {
    if (r.k === 's') searches.set(r.id, r)
    else if (r.k === 'j') judges.push(r)
  }

  let hit = 0
  let miss = 0
  let wrong = 0
  const ranks = []

  for (const j of judges) {
    const s = searches.get(j.id)
    if (!s) continue
    if (j.v === 'hit') {
      hit++
      // 知道该翻到哪条时，顺便记它在第几位
      if (j.e) {
        const idx = (s.top || []).findIndex((x) => Number(x.id) === Number(j.e))
        if (idx >= 0) ranks.push(idx + 1)
      }
    } else if (j.v === 'miss') miss++
    else if (j.v === 'wrong') wrong++
  }

  const judged = hit + miss + wrong
  ranks.sort((a, b) => a - b)

  return {
    total: searches.size,
    judged,
    hit,
    miss,
    wrong,
    recallAt: {
      // 没标注就不给数——给 0 会被人当成「准确率 0」，给 100 会被人当成「全对」
      value: judged >= 10 ? Math.round((hit / judged) * 1000) / 1000 : null,
      ready: judged >= 10,
      need: Math.max(0, 10 - judged),
      label: judged >= 10 ? '' : `还差 ${Math.max(0, 10 - judged)} 次标注才算得出来`,
    },
    medianRank: ranks.length ? ranks[Math.floor(ranks.length / 2)] : null,
    lastAt: rows.length ? rows[rows.length - 1].t : null,
  }
}


/**
 * 分数分布诊断
 * ============
 *
 * 回答一个具体问题：**门槛 0.12 到底是高了还是低了。**
 *
 * 怎么算：
 *   · 标了 miss 的那些查询，看它当时最高分是多少。**这些分数全是「错答案」的分。**
 *   · 如果错答案能拿到 0.3，门槛 0.12 就是摆设——一堆噪音过关了。
 *   · 建议值 = 错答案最高分 × 1.1，至少 0.12。
 *
 * 还会算：
 *   · 命中的那条排第几（中位数、最差）
 *   · hit 的正确分数分布（它离门槛有多远）
 *
 * 样本不足时如实说，不给建议。
 */
export function calibrationReport() {
  const rows = readLog(0)
  const searches = new Map()
  const judges = []
  for (const r of rows) {
    if (r.k === 's') searches.set(r.id, r)
    else if (r.k === 'j') judges.push(r)
  }

  // 只看有标注的
  const hitTop = []      // 命中时，正确那条的分数
  const hitRank = []     // 命中时，它排第几
  const missTop = []     // 落空时，最高分（都是错答案）

  for (const j of judges) {
    const s = searches.get(j.id)
    if (!s || !Array.isArray(s.top) || !s.top.length) continue
    if (j.v === 'hit') {
      let idx = -1
      if (j.e) idx = s.top.findIndex((x) => Number(x.id) === Number(j.e))
      if (idx < 0) idx = 0   // 没给 expect 就按第一位算
      hitTop.push(Number(s.top[idx].s) || 0)
      hitRank.push(idx + 1)
    } else if (j.v === 'miss' || j.v === 'wrong') {
      missTop.push(Number(s.top[0].s) || 0)
    }
  }

  const pct = (arr, p) => {
    if (!arr.length) return null
    const a = [...arr].sort((x, y) => x - y)
    const i = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))
    return Math.round(a[i] * 1000) / 1000
  }

  const samples = hitTop.length + missTop.length
  const need = Math.max(0, 12 - samples)

  const CUR = 0.12
  const worstWrong = missTop.length ? Math.max(...missTop) : 0
  const worstHit = hitTop.length ? Math.min(...hitTop) : null

  // 能不能用一条线把「对的」和「错的」分开？
  // 门槛是 score >= T。要全都对、全不误收，得满足 T > 最错的、T <= 最对的。
  const overlap = (worstHit !== null && missTop.length) ? worstWrong >= worstHit : null

  let suggest = null
  let verdict = '样本不够，先别动门槛'
  if (samples >= 12) {
    if (overlap === true) {
      // 分不开：再高就把对的也杀了，再低就把错的放进来
      verdict = '分数分不开——调门槛救不了，得动检索本身'
      suggest = null
    } else if (worstHit !== null) {
      // 分得开：把门槛抬到「刚好卡住最对的」，错的自然全被拦
      suggest = Math.max(CUR, Math.round(worstHit * 1000) / 1000)
      verdict = suggest > CUR
        ? '门槛偏低——现在错答案也在过关，可以抬到 ' + suggest
        : '门槛合适'
    } else {
      verdict = '还没有「命中」的标注，算不出该抬到哪'
    }
  }

  return {
    ok: true,
    current: CUR,
    samples,
    ready: samples >= 12,
    need,
    note: samples >= 12 ? verdict : `还差 ${need} 次标注才能给建议`,
    suggest,
    hit: {
      count: hitTop.length,
      scoreMin: hitTop.length ? Math.min(...hitTop) : null,
      scoreP25: pct(hitTop, 25),
      scoreMedian: pct(hitTop, 50),
      scoreMax: hitTop.length ? Math.max(...hitTop) : null,
      rankMedian: hitRank.length ? [...hitRank].sort((a, b) => a - b)[Math.floor(hitRank.length / 2)] : null,
      rankWorst: hitRank.length ? Math.max(...hitRank) : null,
    },
    miss: {
      count: missTop.length,
      topMin: missTop.length ? Math.min(...missTop) : null,
      topMedian: pct(missTop, 50),
      topMax: missTop.length ? Math.max(...missTop) : null,
    },
    overlap,
    overlapNote: overlap === null
      ? ''
      : (overlap
        ? '最错的 ' + worstWrong + ' 压过最对的 ' + worstHit + '——分数分不开，光靠门槛拦不住'
        : '最错的 ' + worstWrong + ' 低于最对的 ' + worstHit + '——分得开，一条线能隔住'),
  }
}
