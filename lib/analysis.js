/**
 * 分析
 * ====
 *
 * 四个问题，四个答案：
 *   findAnalogy            —— 哪条记忆跟这条「结构像」（不是内容像）
 *   buildStoryline         —— 她这一路按时间铺开是什么样
 *   findSedimentCandidates —— 哪些事重复出现了，够格升成「认识」
 *   predictRhythm          —— 按真实时间戳看她几点冒头
 *
 * 全是只读的：拿 data 算一遍，返回结果，不改任何东西。
 */

/**
 * 一条记忆的"什么时候"该显示成什么。
 *
 * bornEstimated 的意思是「这个时间是批量导入时按顺序编的」，
 * 不是真发生过的时间。既然如此，就别拿它当日期显示——
 * 显示成「时间未知」比显示一个编出来的日子诚实。
 */
export function bornLabel(p, now) {
  if (!p || !p.born) return '时间未知'
  if (p.bornEstimated) return '时间未知'
  const days = Math.floor(((now || Date.now()) - Number(p.born)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return days + ' 天前'
  return fmtDay(p.born)
}

export function fmtDay(ms) {
  try {
    const d = new Date(Number(ms) || 0)
    const pad = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  } catch {
    return '未知'
  }
}

export function findAnalogy(seedId, data) {
  const pts = (data.points || []).filter((p) => !p.dead && !p.validUntil)
  const byId = new Map(pts.map((p) => [p.id, p]))
  const seed = byId.get(seedId)
  if (!seed) return null

  // 建边索引
  const nb = new Map()   // id -> Set(邻居 id)
  for (const e of (data.edges || [])) {
    if (!nb.has(e.a)) nb.set(e.a, new Set())
    if (!nb.has(e.b)) nb.set(e.b, new Set())
    nb.get(e.a).add(e.b)
    nb.get(e.b).add(e.a)
  }

  const seedNb = nb.get(seedId) || new Set()
  if (seedNb.size < 2) return null

  // 种子邻居的「画像」：实体 + 类型
  const profile = (id, set) => {
    const ents = new Set()
    const kinds = new Set()
    for (const nid of set) {
      const p = byId.get(nid)
      if (!p) continue
      for (const e of (p.entities || [])) ents.add(e)
      kinds.add(p.kind || 'fact')
    }
    return { ents, kinds }
  }

  const seedP = profile(seedId, seedNb)

  const cands = []
  for (const p of pts) {
    if (p.id === seedId) continue
    const set = nb.get(p.id) || new Set()
    if (set.size < 2) continue
    const pr = profile(p.id, set)
    // 实体重合
    let overlap = 0
    for (const e of pr.ents) if (seedP.ents.has(e)) overlap++
    if (overlap === 0) continue
    // 内容要不像（否则就不是类比而是重复）
    const s = String(seed.text || '')
    const q = String(p.text || '')
    if (s && q && s.slice(0, 20) === q.slice(0, 20)) continue
    // 邻居数量的接近度
    const sizeSim = 1 - Math.abs(seedNb.size - set.size) / Math.max(seedNb.size, set.size)
    const score = overlap * 0.5 + sizeSim * 0.5
    cands.push({ p, score, overlap })
  }
  cands.sort((a, b) => b.score - a.score)
  return cands.slice(0, 3).map((x) => ({
    id: x.p.id,
    title: x.p.title,
    score: Number(x.score.toFixed(2)),
    why: '这两件事不一样，但处境像——都跟 ' + x.overlap + ' 个人/事有关',
  }))
}

export function buildStoryline(data, opts) {
  const includeDream = !!(opts && opts.dream)
  const pts = (data.points || []).filter((p) => {
    if (p.dead) return false
    if (!includeDream && p.origin === 'dream') return false
    return true
  })

  // 主线：核心层 + 沉淀 + 里程碑，按时间排
  const main = pts
    .filter((p) => p.layer === 'core' || p.layer === 'sediment' || p.gold)
    .sort((a, b) => (Number(a.born) || 0) - (Number(b.born) || 0))

  // 按「纪元」分段：每 30 天一段
  const eras = []
  let cur = null
  for (const p of main) {
    const day = Math.floor((Number(p.born) || 0) / 86400000)
    if (!cur || day - cur.day0 > 30) {
      cur = { day0: day, from: p.born, items: [] }
      eras.push(cur)
    }
    cur.items.push(p)
  }

  const fmt = (ms) => {
    try {
      const d = new Date(Number(ms))
      const pad = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    } catch { return '?' }
  }

  const lines = []
  for (const era of eras) {
    lines.push('【' + fmt(era.from) + ' 起】')
    for (const p of era.items) {
      const mark = p.gold ? '★ ' : (p.layer === 'sediment' ? '◆ ' : '· ')
      lines.push(mark + bornLabel(p) + '  ' + String(p.title || '').trim())
    }
    lines.push('')
  }

  // 梦境单独一栏
  if (includeDream) {
    const dreams = pts.filter((p) => p.origin === 'dream')
      .sort((a, b) => (Number(a.born) || 0) - (Number(b.born) || 0))
    if (dreams.length) {
      lines.push('【她做过的梦】')
      for (const p of dreams.slice(-20)) {
        lines.push('· ' + bornLabel(p) + '  ' + String(p.title || '').trim())
      }
    }
  }

  return {
    eras: eras.length,
    items: main.length,
    text: lines.join('\n').trim(),
  }
}

export function findSedimentCandidates(data) {
  const pts = (data.points || []).filter((p) => !p.dead && !p.validUntil)
  // 按「实体 + 分类」分组
  const groups = new Map()
  for (const p of pts) {
    if (p.layer === 'sediment' || p.layer === 'core') continue
    const ents = (p.entities || []).slice(0, 2)
    const cats = (p.category || []).slice(0, 1)
    if (!ents.length || !cats.length) continue
    const key = ents.join('+') + '|' + cats[0]
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const out = []
  for (const [key, list] of groups) {
    if (list.length < 3) continue
    // 必须来自不同的日子（同一天说三遍不算）
    const days = new Set(list.map((p) =>
      Math.floor((Number(p.born) || 0) / 86400000)))
    if (days.size < 3) continue
    // 可信度要够
    const conf = list.reduce((s, p) => s + (Number(p.confidence) || 0.8), 0) / list.length
    if (conf < 0.6) continue
    const [ents, cat] = key.split('|')
    out.push({
      key,
      count: list.length,
      days: days.size,
      confidence: Number(conf.toFixed(2)),
      entities: ents.split('+'),
      category: cat,
      titles: list.slice(0, 4).map((p) => p.title),
      hint: '「' + ents.split('+').join('」和「') + '」这事，在 ' + days.size
        + ' 个不同的日子出现过 ' + list.length + ' 次',
    })
  }
  out.sort((a, b) => b.days - a.days)
  return out.slice(0, 8)
}

export function predictRhythm(data) {
  // 只用「真时间」的点——估出来的时间算不出作息
  const pts = (data.points || []).filter((p) => !p.dead && !p.bornEstimated)
  if (pts.length < 10) {
    const all = (data.points || []).filter((p) => !p.dead)
    return {
      hours: [], summary: '还看不出作息。',
      night: false,
      note: '（' + all.length + ' 条记忆里只有 ' + pts.length
        + ' 条是真时间，其余是批量导入时估的。攒够 ' + (10 - pts.length) + ' 条真时间就能看了。）',
    }
  }

  // 按小时统计
  const byHour = new Array(24).fill(0)
  for (const p of pts) {
    const t = Number(p.born) || 0
    if (!t) continue
    const h = new Date(t).getHours()
    byHour[h]++
  }
  // 找最活跃的几个小时
  const sorted = byHour.map((n, h) => ({ h, n })).sort((a, b) => b.n - a.n)
  const top = sorted.slice(0, 3).filter((x) => x.n > 0)
  if (!top.length) return null

  const span = (hours) => {
    const min = Math.min(...hours)
    const max = Math.max(...hours)
    return min === max ? (min + ' 点前后') : (min + ' 点到 ' + max + ' 点')
  }
  const hours = top.map((x) => x.h).sort((a, b) => a - b)
  const night = hours.some((h) => h >= 1 && h <= 4)

  return {
    hours: top.map((x) => x.h),
    summary: '他一般在这个时间段冒出来：' + span(hours),
    night,
    note: night ? '其中有一截是半夜——这个点别问他在不在。' : '',
  }
}