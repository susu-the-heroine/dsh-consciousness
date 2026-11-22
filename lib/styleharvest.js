/**
 * 采风格：从用户消息里提「他怎么说话」
 * ==================================
 * 2026-11-22 新增。原则（苏苏侠定的）：
 *   - 只从用户消息采，不采 AI 自己的话
 *   - 同一现象要三次、跨两个日期、跨两种说法，才算一条
 *   - 打错字、语音转文字错不采（它们不会稳定三次还跨日期）
 *   - 骂人词要显式允许（默认不采）
 *   - 采到的不是「规矩」，是「观察」：写他怎么做，不写她该怎么写
 *
 * 导出：
 *   observe(text, at, opt)  → 这一条里看见的候选 [{ key, pattern, cat, sample }]
 *   harvest(entries, opt)   → 从一批 {text, at} 里算出门槛够的 [{ key, pattern, cat, count, dates, texts, sample }]
 */

// 骂人/脏话候选。默认不采，要 opt.allowProfanity === true
const PROFANITY = ['傻屌', '傻福', '他妈的', '妈的', '卧槽', '操蛋', '去球', '滚蛋', '狗日的']
// 语气词：只看比例，不单条计数
const TONE = /[哈呗吧啊嘛呀哦噢诶嘿]/g
// 口癖候选：2~3 个字的重复片段，先排除一堆常用词
const STOP = new Set(['一个', '这个', '那个', '就是', '不是', '可以', '然后', '还是', '没有', '什么', '怎么', '因为', '所以', '现在', '已经', '自己', '时候', '这样', '那样', '知道', '觉得', '应该', '其实', '真的', '有点', '一下', '一起', '出来', '起来', '过来', '东西', '问题', '地方', '事情'])

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/** 这一条里看见的候选 */
export function observe(text, at = Date.now(), opt = {}) {
  const t = normalize(text)
  const out = []
  if ([...t].length < 4) return out

  // 1 标点习惯：一句话收尾不点标点（句号、感叹号、问号都没有）
  if ([...t].length >= 8 && !/[。！？!?]$/.test(t)) {
    out.push({ key: 'punct-no-end', pattern: '他打字句末不点标点', cat: '标点', sample: t.slice(0, 20) })
  }
  // 2 用空格断句
  if (/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(t)) {
    out.push({ key: 'punct-space', pattern: '他用空格断句，不写标点', cat: '标点', sample: t.slice(0, 20) })
  }
  // 3 语气词比例：一条里 3 个以上
  const tone = (t.match(TONE) || []).length
  if (tone >= 3) {
    out.push({ key: 'tone-many', pattern: '他说话爱带语气词', cat: '语气', sample: t.slice(0, 20) })
  }
  // 4 骂人词：要显式允许
  if (opt.allowProfanity === true) {
    for (const w of PROFANITY) {
      if (t.includes(w)) out.push({ key: 'prof-' + w, pattern: '他急了会骂「' + w + '」', cat: '骂人', sample: t.slice(0, 30) })
    }
  }
  // 5 口癖：2~3 字片段出现两次以上
  const grams = new Map()
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= t.length; i++) {
      const g = t.slice(i, i + n)
      if (!/^[\u4e00-\u9fa5]+$/.test(g)) continue
      if (STOP.has(g)) continue
      grams.set(g, (grams.get(g) || 0) + 1)
    }
  }
  for (const [g, c] of grams) {
    if (c >= 2 && c <= 4) out.push({ key: 'tic-' + g, pattern: '他常说「' + g + '」', cat: '口癖', sample: t.slice(0, 20) })
  }
  // 6 句长：极短（≤6 字）说明他习惯短句
  if ([...t].length <= 6) {
    out.push({ key: 'short-very', pattern: '他常一句话就几个字', cat: '句长', sample: t })
  }

  const day = new Date(at).toISOString().slice(0, 10)
  return out.map((o) => ({ ...o, day }))
}

/** 门槛：三次、跨两个日期、跨两种说法 */
export function harvest(entries, opt = {}) {
  const seen = new Map()
  for (const e of entries) {
    const day = new Date(e.at || Date.now()).toISOString().slice(0, 10)
    for (const o of observe(e.text, e.at, opt)) {
      const cur = seen.get(o.key) || { key: o.key, pattern: o.pattern, cat: o.cat, count: 0, days: new Set(), texts: new Set(), sample: o.sample }
      cur.count++
      cur.days.add(o.day || day)
      cur.texts.add(normalize(e.text).slice(0, 40))
      seen.set(o.key, cur)
    }
  }
  const out = []
  for (const v of seen.values()) {
    if (v.count < 3) continue
    if (v.days.size < 2) continue
    if (v.texts.size < 2) continue
    out.push({ key: v.key, pattern: v.pattern, cat: v.cat, count: v.count, dates: v.days.size, texts: v.texts.size, sample: v.sample })
  }
  return out
}

/**
 * 挑选注入：只取「跟」的，按可信度排，最多两条；同一条连续两天不许重复。
 * points 里每条要是 { id, adopt, conf, key, pattern, today, lastUsedDay }
 * 返回 { picked: [...], skipped: [...] }
 */
export function selectForInject(points, opt = {}) {
  const today = opt.today || new Date().toISOString().slice(0, 10)
  const limit = Number(opt.limit) || 2
  const list = (points || [])
    .filter((p) => p && p.adopt === true && typeof p.pattern === 'string' && p.pattern)
    .sort((a, b) => (Number(b.conf) || 0) - (Number(a.conf) || 0))
  const picked = []
  const skipped = []
  for (const p of list) {
    if (picked.length >= limit) { skipped.push({ id: p.id, why: '超出两条' }); continue }
    if (p.lastUsedDay === today) { skipped.push({ id: p.id, why: '今天用过' }); continue }
    picked.push(p)
  }
  return { picked, skipped }
}

/**
 * 退场：多久没出现就降权/不跟。
 * 返回新的 { conf, adopt }
 */
export function decayStyle(p, opt = {}) {
  const now = Number(opt.now) || Date.now()
  const last = Number(p && p.lastSeenAt) || 0
  if (!last) return { conf: Number(p && p.conf) || 0, adopt: Boolean(p && p.adopt) }
  const days = (now - last) / 86400000
  const conf = Number(p.conf) || 0
  if (days >= 60) return { conf: Math.min(conf, 0.2), adopt: false }
  if (days >= 30) return { conf: Math.max(0, conf - 0.2), adopt: Boolean(p.adopt) }
  return { conf, adopt: Boolean(p.adopt) }
}
