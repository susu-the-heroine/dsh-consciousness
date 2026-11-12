/**
 * 查询解析
 * ========
 *
 * 两件事：
 *   时间窗 —— 「昨天聊了什么」不该走内容匹配，该按时间倒序列出来
 *   否定   —— 「别给我看吵架那些」要能识别，不然她照样把吵架的翻出来
 */

/* ---------- 时间意图 ----------
 * 「昨天聊了什么」「上周那事」——之前完全做不到，只按字面查。
 * 这层把查询里的时间词解析成一个区间，检索时按 born 过滤。
 */
export const TIME_WINDOWS = [
  { pat: /今天|今日/, days: 1, label: '今天' },
  { pat: /昨天|昨日/, from: 1, to: 2, label: '昨天' },
  { pat: /前天/, from: 2, to: 3, label: '前天' },
  { pat: /最近\s*(\d+)\s*天/, dyn: true, label: '最近 N 天' },
  { pat: /这周|本周|这一周/, days: 7, label: '这周' },
  { pat: /上周|上个星期|上一周/, from: 7, to: 14, label: '上周' },
  { pat: /这个月|本月/, days: 30, label: '这个月' },
  { pat: /上个月|上月/, from: 30, to: 60, label: '上个月' },
  { pat: /半年前/, from: 180, to: 365, label: '半年前' },
  { pat: /去年/, from: 365, to: 730, label: '去年' },
]

/** 从查询里抠出时间窗。返回 {from, to, label, rest} 或 null */
export function parseTimeWindow(query) {
  const q = String(query || '')
  const now = Date.now()
  for (const w of TIME_WINDOWS) {
    const m = w.pat.exec(q)
    if (!m) continue
    let from, to
    if (w.dyn) {
      const n = Math.max(1, Math.min(365, Number(m[1]) || 7))
      from = 0
      to = n
    } else if (w.from !== undefined) {
      from = w.from
      to = w.to
    } else {
      from = 0
      to = w.days
    }
    // 只把时间词从查询里抠掉，剩下的当内容查
    const rest = q.replace(w.pat, ' ').replace(/\s+/g, ' ').trim()
    return {
      fromMs: now - to * 86400000,
      toMs: now - from * 86400000,
      label: w.label.replace('N', String(w.dyn ? (Number(m[1]) || 7) : '')),
      rest,
    }
  }
  return null
}

/* ---------- 否定 ----------
 * 「不是那次吵架」——之前照样把「吵架」全翻出来。
 */
export const NEG_PATTERNS = [
  /不是([^，。,\s]{2,12})/g,
  /除了([^，。,\s]{2,12})/g,
  /别提([^，。,\s]{2,12})/g,
  /去掉([^，。,\s]{2,12})/g,
]

/** 抠出要排除的词。返回 string[] */
export function parseNegations(query) {
  const q = String(query || '')
  const out = []
  for (const pat of NEG_PATTERNS) {
    pat.lastIndex = 0
    let m
    while ((m = pat.exec(q)) !== null) {
      const w = String(m[1] || '').trim()
      if (w.length >= 2) out.push(w)
    }
  }
  return out
}
