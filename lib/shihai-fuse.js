/**
 * 四路融合：字面 + 实体 + 结构 + 向量。
 *
 * 每条路管一件 bge 管不了或管不好的事：
 *   字面 BM25   专有词（经十路、薯片渣、GMod）
 *   实体命中    提到谁（大肥鱼 68 次、识海 63、大魔王 48）
 *   结构加权    什么时候、什么情绪、多重要、多常想起
 *   向量        换个说法时唯一能对上的（由调用方传入分数）
 *
 * 实测（真记忆 252 条 / 138+59 条查询）：
 *   纯语义换说法：bge 26.1，字面 19.6，向量 14.5 —— 这一档认输但不许掉
 *   带实体：字面 44.1，实体 96.6，合起来 top5 100 —— 这一档碾压
 *   真实分布 48.3% 带实体时，加权赢 31.3 点
 */

import { normalize } from './shihai-norm.js'
const W = 86400000

/* ---------- 结构解析 ---------- */

// 2026-11-26 补：原来只认相对时间（今天/昨天/上周/去年），绝对年月一个不认。
// 实测「2022年5月关于社交活动的那次」→ time:null，结构路全程空转。
const ABS_TIME_RULES = [
  // 2022年5月12日 / 2022年5月 / 2022-05-12 / 2022-05 / 2022/05
  { re: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/, ymd: true },
  { re: /(\d{4})\s*年\s*(\d{1,2})\s*月/, ym: true },
  { re: /(\d{4})\s*[-\/]\s*(\d{1,2})\s*[-\/]\s*(\d{1,2})/, ymd: true },
  { re: /(\d{4})\s*[-\/]\s*(\d{1,2})/, ym: true },
  { re: /(\d{4})\s*年/, yOnly: true },
]

function absTimeWindow(q, nowMs) {
  for (const r of ABS_TIME_RULES) {
    const m = q.match(r.re)
    if (!m) continue
    const y = Number(m[1])
    if (!y || y < 1950 || y > 2100) continue
    if (r.yOnly) {
      const lo = Date.UTC(y, 0, 1), hi = Date.UTC(y, 11, 31)
      return { lo, hi, label: `${y}年` }
    }
    const mo = Math.max(1, Math.min(12, Number(m[2]) || 1))
    if (r.ymd) {
      const d = Math.max(1, Math.min(31, Number(m[3]) || 1))
      const lo = Date.UTC(y, mo - 1, d), hi = lo + 86400000
      return { lo, hi, label: `${y}-${mo}-${d}` }
    }
    const lo = Date.UTC(y, mo - 1, 1), hi = Date.UTC(y, mo, 1)
    return { lo, hi, label: `${y}-${mo}` }
  }
  return null
}

const TIME_RULES = [
  { re: /今天|今日/, win: [0, 1] },
  { re: /昨天|昨日/, win: [1, 2] },
  { re: /这几天|这两天|最近几天/, win: [0, 5] },
  { re: /上周|上星期/, win: [5, 14] },
  { re: /上个月|上月/, win: [20, 45] },
  { re: /前阵子|前段时间|不久前/, win: [45, 150] },
  { re: /去年/, win: [300, 800] },
  { re: /好久以前|很久以前|当年/, win: [150, 9999] },
  { re: /最早|最开始|第一次/, win: null, earliest: true },
]

const EMO_RULES = [
  { re: /难受|难过|伤心|哭|崩|委屈|痛/, pol: -1 },
  { re: /生气|气死|火大|烦|恶心|讨厌/, pol: -1 },
  { re: /怕|害怕|慌|紧张/, pol: -1 },
  { re: /开心|高兴|爽|踏实|感动|幸福|笑/, pol: 1 },
  { re: /得意|骄傲|值了|赚了/, pol: 1 },
]

const FREQ_RE = /老提|总提|老说|总说|老想|总想|最常|一直记着|反复|经常|总是|常常|天天|每次|几乎每天|动不动/

/**
 * 解析查询里的结构线索。
 * 返回 { time, earliest, polarity, freq }，全部为「没出现」时返回空对象。
 */
export function parseStruct(query, nowMs = Date.now()) {
  const q = String(query || '')
  const out = { time: null, earliest: false, polarity: 0, freq: false }
  // 先看绝对年月（2022年5月），它比相对时间更明确
  const abs = absTimeWindow(q, nowMs)
  if (abs) out.time = [abs.lo, abs.hi]
  for (const r of TIME_RULES) {
    if (r.re.test(q)) {
      if (r.earliest) out.earliest = true
      else out.time = r.win
      break
    }
  }
  for (const r of EMO_RULES) {
    if (r.re.test(q)) { out.polarity = r.pol; break }
  }
  if (FREQ_RE.test(q)) out.freq = true
  return out
}

/**
 * 给一批记忆算结构加分。
 * 只在查询真出现某类线索时才加——没有线索就返回空 Map，不影响排序。
 */
export function structBonus(parsed, memories, nowMs = Date.now()) {
  const bonus = new Map()
  if (!memories || !memories.length) return bonus
  const add = (id, v) => bonus.set(id, (bonus.get(id) || 0) + v)
  // 2026-11-26 修的 bug：库里 born 是字符串 "2022-05-12"，
  // 原来写 Number(m.born) 得到 NaN 再 ||0 变成 0，所有记忆都当成 0 年，时间窗口永远框不住。
  const toMs = (v) => {
    if (v == null || v === '') return 0
    if (typeof v === 'number') return v > 1e11 ? v : v * 1000
    const str = String(v).trim()
    const m = str.match(/^(\d{4})[-\/年]?(\d{1,2})?[-\/月]?(\d{1,2})?/)
    if (m) {
      const y = Number(m[1])
      const mo = Number(m[2] || 1)
      const d = Number(m[3] || 1)
      if (y > 1900 && y < 2200) return Date.UTC(y, mo - 1, d)
    }
    const n = Number(str)
    if (Number.isFinite(n) && n > 0) return n > 1e11 ? n : n * 1000
    return 0
  }
  const tOf = (m) => toMs(m.born ?? m.at ?? m.addedAt ?? 0)

  if (parsed.time) {
    // 2026-11-26 踩的坑：绝对年月（2022年5月）解析出来是毫秒时间戳（1.65e12），
    // 但这里原来写的是 (nowMs - t) / W，比的是「多少天前」。
    // 一个 1.65e12、一个 30，永远对不上，bonus 一条都加不出来。
    // 现在分开：时间戳够大就是绝对窗口，直接比 t；否则按「多少天前」比。
    const [lo, hi] = parsed.time
    const absolute = lo > 1e11
    for (const m of memories) {
      const t = tOf(m)
      if (!t) continue
      if (absolute) {
        if (t >= lo && t < hi) add(m.id, 0.8)
      } else {
        const d = (nowMs - t) / W
        if (d >= lo && d < hi) add(m.id, 0.8)
      }
    }
  }
  if (parsed.earliest) {
    let best = null, bt = Infinity
    for (const m of memories) {
      const t = tOf(m)
      if (t && t < bt) { bt = t; best = m.id }
    }
    if (best !== null) add(best, 0.7)
  }
  if (parsed.polarity !== 0) {
    for (const m of memories) {
      if (Number(m.polarity ?? 0) === parsed.polarity) add(m.id, 0.6)
    }
  }
  if (parsed.freq) {
    const arr = memories
      .map((m) => [m.id, Number(m.recallCount ?? m.recall ?? 0)])
      .filter((x) => x[1] > 0)
      .sort((a, b) => b[1] - a[1])
    const cut = Math.max(1, Math.floor(arr.length * 0.2))
    for (const [id] of arr.slice(0, cut)) add(id, 0.4)
  }
  return bonus
}

/* ---------- 实体索引（首字分桶） ---------- */

/**
 * 实体 + 别名按首字分桶。
 * 复杂度 O(查询长度 × 同首字桶大小)，不是 O(实体总数)。
 */
export function buildEntityIndex(memories) {
  const buckets = new Map()
  const push = (raw, id) => {
    const e = String(raw || '').toLowerCase().trim()
    if (e.length < 2) return
    const head = e[0]
    let arr = buckets.get(head)
    if (!arr) { arr = []; buckets.set(head, arr) }
    arr.push([e, id])
  }
  for (const m of memories) {
    for (const e of (m.entities || [])) push(e, m.id)
    const al = String(m.alias || '')
    for (const seg of (al.match(/[\u4e00-\u9fff]{3,8}/g) || [])) push(seg, m.id)
  }
  for (const arr of buckets.values()) arr.sort((a, b) => b[0].length - a[0].length)
  // 每个实体覆盖多少条记忆。一个实体覆盖太多条 = 没有区分度
  // （PerLTQA 一个人 24 条事件、人名在 24 条里全出现，就是极端例）
  const df = new Map()
  for (const arr of buckets.values()) {
    for (const [e, id] of arr) {
      if (!df.has(e)) df.set(e, new Set())
      df.get(e).add(id)
    }
  }
  for (const [e, set] of df) df.set(e, set.size)
  buckets.df = df
  return buckets
}

export function matchEntities(query, index) {
  const q = String(query || '').toLowerCase()
  if (!q) return []
  const hit = new Set()
  for (let i = 0; i < q.length; i++) {
    const arr = index.get(q[i])
    if (!arr) continue
    for (const [e, id] of arr) {
      if (q.startsWith(e, i)) hit.add(id)
    }
  }
  return [...hit]
}

/** 命中的实体里最窄的那个覆盖多少条——用来给实体路定权重。越窄越有区分度。 */
export function entSpread(query, index) {
  const q = String(query || '').toLowerCase()
  const df = index && index.df
  if (!q || !df) return 0
  let best = Infinity
  for (let i = 0; i < q.length; i++) {
    const arr = index.get(q[i])
    if (!arr) continue
    for (const [e] of arr) {
      if (q.startsWith(e, i)) {
        const n = df.get(e) || 0
        if (n > 0 && n < best) best = n
      }
    }
  }
  return best === Infinity ? 0 : best
}

/* ---------- 字面 ---------- */

const WORD = /[a-zA-Z]+|\d+/g

export function toks(s) {
  // 先归一：kg/公斤/千克、km/公里、全角数字，让「同一个意思不同写法」撞同一个键
  const low = normalize(String(s || '')).toLowerCase()
  const out = low.match(WORD) || []
  for (const seg of (low.match(/[\u4e00-\u9fff]+/g) || [])) {
    if (seg.length === 1) { out.push(seg); continue }
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2))
    // 三字词：二元切分会把「元宵节」切成「元宵」「宵节」，两段都不完整。
    // 三字词试过：别人库上 68.5 → 66.3，掉 2.2，撤掉。别再试。
    // 单字也进索引，但挂前缀标记区分，权重另算。
    // 依据：2026-11-26 别人库上 11 条找不到的里，「茶文化」对不上「龙井茶」、
    // 「邻居交流」对不上「邻里关系」——共同字都在，只是二元切分把它们扔了。
    for (const ch of seg) out.push('·' + ch)
  }
  return out
}

export function buildLexicalIndex(memories) {
  const posting = new Map()
  const dl = new Map()
  let total = 0
  for (const m of memories) {
    const ts0 = toks(String(m.title || '') + ' ' + String(m.text || ''))
    // 标题加权试过（3 倍），在别人库上 65.0 → 64.0，反而掉。撤掉，留一行记着别再试。
    const ts = ts0
    dl.set(m.id, ts.length)
    total += ts.length
    const tf = new Map()
    for (const t of ts) tf.set(t, (tf.get(t) || 0) + 1)
    for (const [t, c] of tf) {
      let pl = posting.get(t)
      if (!pl) { pl = new Map(); posting.set(t, pl) }
      pl.set(m.id, c)
    }
  }
  return { posting, dl, N: memories.length, avgdl: total / Math.max(1, memories.length) }
}

// 2026-11-26 细扫（三份库，k1 1.2-2.0 x b 0.65-0.85）：
//   k1=1.4 b=0.8 是四份库里最稳的那个点（最差一档只掉 0.5）。
//   主库 84.3（原 84.2），T2-3371 85.5（原 84.5），T2-5万 62.5（原 60.0），T2-1万 79.5（原 80.0）。
//   教科书默认 1.2/0.75 在长网页段落上惩罚过重。
const K1 = Number(process.env.FUSE_K1) || 1.4
const B = Number(process.env.FUSE_B) || 0.8
// 单字词（前缀 ·）的权重系数。1.0 = 和二元词同等，0 = 不用单字。
// 2026-11-26 在别人库上扫出来的。
let UNI_W = 0.75
/** 给外部调参用（跑实验），正常链路不动它。 */
export function setUniWeight(w) { UNI_W = Number(w) }

/**
 * 只算字面分，返回 id → 分。bm25Top 和 fuse 共用这一份，别扫两遍倒排。
 * 2026-11-26：五万条上扫两遍会从 5.23ms 涨到 11.90ms（超 10ms 线）。
 */
export function bm25Scores(query, idx) {
  const { posting, dl, N, avgdl } = idx
  const scores = new Map()
  // 2026-11-26：五万条实测 BM25 扫表 22.27ms，占整条 93%。
  // 肥尾全是单字：「·的」命中 45953 条、「·一」38763——扫它们既慢又灌水。
  // 所以 df 超过全库 FAT_DF 比例的词直接跳过：它们本来就没有区分度。
  const FAT_DF = Number(process.env.FUSE_FAT_DF) || 0.15
  for (const t of new Set(toks(query))) {
    const pl = posting.get(t)
    if (!pl) continue
    const df = pl.size
    if (N >= 200 && df > N * FAT_DF) continue
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (t.charCodeAt(0) === 183 ? UNI_W : 1)
    for (const [pid, tf] of pl) {
      const d = dl.get(pid) || 1
      const s = idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * d / avgdl))
      scores.set(pid, (scores.get(pid) || 0) + s)
    }
  }
  return scores
}

export function bm25Top(query, idx, k = 40) {
  const scores = bm25Scores(query, idx)
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((x) => x[0])
}

/* ---------- 融合 ---------- */

const RRF_K = 60

/**
 * 四路融合，返回排好序的 id。
 *
 * @param {string} query
 * @param {Array} memories
 * @param {{ent:any, lex:any}} idx  buildIndexes 的产物
 * @param {{vecScores?: Map<number,number>, topk?:number, nowMs?:number}} opts
 *        vecScores 是「id -> 向量相似度」，没有向量模型时可以不传
 */
export function fuse(query, memories, idx, opts = {}) {
  const topk = opts.topk ?? 20
  const nowMs = opts.nowMs ?? Date.now()
  const q = String(query || '')
  if (!q || !memories || !memories.length) return []

  const scoreMapRaw = bm25Scores(q, idx.lex)
  // 整张分表只排这一次，下面取前 40 和前 200 都复用。
  // 排两次的话五万条会从 5.2ms 涨到 8.87ms。
  const sortedRawAll = [...scoreMapRaw.entries()].sort((a, b) => b[1] - a[1])
  const lex = sortedRawAll.slice(0, 40).map((x) => x[0])
  const ent = matchEntities(q, idx.ent)
  const parsed = parseStruct(q)
  const bonus = structBonus(parsed, memories, nowMs)

  // 2026-11-26 实测（真人查询 600 条 / 主库 252 条）：
  //   RRF 融合 top1 76.2%
  //   纯字面分 top1 84.2%   ← 高 8 个点
  // 病根：RRF 只看第几名，把分数差距扔了。字面分 90 和 12 的候选，RRF 里只差一个名次。
  // 小库上这特别致命。所以改成「原始分数为主，RRF 只做兜底」。
  const useScore = opts.useScore !== false
  // 复用上面那次 bm25 扫表的结果，不再重扫。
  // 2026-11-26：重扫会让五万条从 5.23ms 涨到 11.90ms，超线。
  const scoreMap = useScore ? scoreMapRaw : new Map()

  const sc = new Map()
  const add = (id, v) => sc.set(id, (sc.get(id) || 0) + v)

  // 权重可调：2026-11-26 在别人库上发现，实体命中一个人 24 条时会互相稀释，
  // 这时候字面（尤其带 idf）反而更准。默认保持 1.0/1.0 不动，只在 opts 里能改。
  const wLex = opts.wLex ?? 1.0
  let wEnt = opts.wEnt
  if (wEnt === undefined) {
    // 动态：命中的实体越窄越可信。
    // 覆盖 > 40 条 → 0.15（几乎没区分度，比如一个人 24 条）
    // 10–40 条 → 0.5
    // < 10 条 → 1.0
    // 2026-11-26 实测（600 条六类查询 / 3037 条库）：
    //   纯字面在实体查询上 81.0%，加上实体路反掉到 57.0%——拖了 24 个点。
    //   原因：一个人名下 24 条事件，实体一命中 24 条全灌进来，正解被稀释。
    //   所以改成：覆盖 ≥ 10 条就完全不给它说话。只有窄实体才让它插手。
    const spread = entSpread(q, idx.ent)
    wEnt = spread === 0 || spread >= 10 ? 0 : 1.0
  }
  // 字面
  for (let i = 0; i < lex.length; i++) add(lex[i], wLex / (RRF_K + i + 1))
  // 实体
  for (let i = 0; i < ent.length; i++) add(ent[i], wEnt / (RRF_K + i + 1))
  // 向量：不往整个候选池加分，只在最后一步重排前几名。理由见文件末尾那段。
  // 结构：直接加绝对分（只在有线索时非空）
  if (bonus.size) {
    const max = sc.size ? Math.max(...sc.values(), 1e-9) : 1e-9
    for (const [id, b] of bonus) add(id, b * max * 0.5)
  }

  if (opts.noRrf) {
    // 实验用：把 RRF 那部分彻底扔掉，只留原始分
    sc.clear()
    for (const [id, v] of scoreMap) sc.set(id, v)
  }
  // 用原始字面分排序（如果拿到了分）；RRF 分会作为小权重兜底。
  // 只塞前 200 名：RRF 最大贡献 1/61 ≈ 0.016，盖不过归一化后的 2.0，
  // 200 名以外没有翻盘可能。全塞的话五万条会多花 5ms（10.57ms，超 10ms 线）。
  if (useScore && scoreMap.size && !opts.noRrf) {
    const sortedRaw = sortedRawAll.slice(0, 200)
    const maxRaw = sortedRaw.length ? sortedRaw[0][1] : 1e-9
    for (const [id, v] of sortedRaw) add(id, (v / maxRaw) * 2.0)
  }
  // 窄实体加一点（只在实体很窄时）
  const _spread = entSpread(q, idx.ent)
  const entW = opts.entBonusW === undefined ? 0.2 : Number(opts.entBonusW)
  if (!opts.noEntBonus && entW > 0 && _spread > 0 && _spread < 10) {
    const max = sc.size ? Math.max(...sc.values(), 1e-9) : 1e-9
    for (const id of ent) add(id, max * entW)
  }

  // 向量：只在最后一步重排前几名，不往整个候选池加分。
  // 2026-11-27 实测（T2Ranking 3371 条 / 200 查，向量是我们自己训的 63.0% 那版）：
  //   全量重排前 5 名         top1 85.5→86.5  top3 +1.5  top5 持平
  //   全量重排前 10 名        top1 87.0  top5 95.5（掉）
  //   全池加分                top1 87.0  top5 94.5（掉 1.5）
  //   margin<0.15 权重2        top1 86.5  top5 持平
  //   margin<0.25 权重2        top1 87.5  top5 持平   ← 3371 上最好
  //   margin<0.35 权重2        top1 87.0
  //   margin<0.5  权重2        top1 85.0（动太多，退回全量重排那个坑）
  //
  // 但泛化检查没过：同一批查询换到五万条库上
  //   不动          62.5 / 80.5 / 85.0
  //   margin<0.25   61.5 / 81.5 / 85.0   ← 反而掉 1.0
  //   margin<0.15   62.5 / 82.0 / 85.0   ← 持平
  // 3371 上那 +2.0 是 4 条查询，五万上那 −1.0 是 2 条，**两边都在噪声里**。
  // 200 条查询上扫出来的阈值，换库不转移——这就是「只在一份考核上调参」那个坑。
  //
  // ★ 2026-11-27 换模型之后重扫（v7 向量：单打 T2-3371 从 63.0 涨到 76.0，是数据量涨 6.6 倍带来的）：
  //   T2-3371  不给向量 85.5 → 权重1/2 + margin<0.25 都是 88.0（bge 88.5，只差 0.5）
  //   T2-5万   不给向量 62.5 → 权重1 62.0 / 权重2 61.5（掉 0.5，噪声）
  // 这次和上次不同：不是扫阈值扫出来的，是模型能力真涨了 13 个点，
  // 而且权重 1 和 2 都给同一个数（不敏感）。所以默认开，权重 1.0。
  const _N = (memories && memories.length) || 0
  const _BIG = _N >= Number(process.env.FUSE_VEC_BIG || 10000)
  // 2026-11-28：换引擎之后这三个默认值全部重定。
  // 之前那套（权重 0.3、头 20、窄门 margin<0.25）是给「单打 76.0 的词袋模型」调的——
  // 那个向量只够微调次序，给它话语权就毁精度。
  // 现在换成 bge-small int8（单打 86.5），结论反过来：门开到底、头放到 50 更好。
  // 实测 T2-3371（同一批 200 条查询）：
  //   窄门/头20  90.0 / 94.5 / 96.5 / 97.0  nDCG 88.0
  //   全开/头20  90.0 / 95.0 / 96.5 / 97.0  nDCG 88.9
  //   全开/头50  90.0 / 95.0 / 97.0 / 97.5  nDCG 89.2（bge 自己是 89.4）
  // 2026-11-28：不再分「强引擎/弱引擎」两档。bge 现在四档库全都能用
  // （五万条的崩溃是 onnxruntime 内存池，关掉 enableCpuMemArena 解决），
  // 所以「库≥2万退回词袋」那套兜底连同参数（权重 0.3、头 20）一起作废。
  // 实测五万条给 bge 之后，权重 1 / 头 50 明显更好：
  //   权重 0.3 头 20：63.5 / 82.5 / 85.5 / 95.5，没捞到 9
  //   权重 1.0 头 50：66.5 / 86.0 / 88.5 / 97.0，没捞到 6
  // 2026-11-27：按库类型自动切。记忆库（短条目）上向量是负的，实测三处库都一个结论：
  //   3037 条记忆库：不用向量 86.2，用向量 81.3（-4.9）
  //   他 252 条库：字面 71.9，字面+向量 67.6（-4.3）
  //   3371 条文档库：用向量 88.0，不用 85.5（+2.5）
  // 所以：平均文本长度够长的当文档库（向量全开），短的当记忆库（向量关）。
  // 环境变量仍然优先，方便调试。
  let _autoVecW = null
  if (Array.isArray(memories) && memories.length) {
    let _sum = 0
    const _n = Math.min(memories.length, 400)
    for (let _i = 0; _i < _n; _i++) {
      const _m = memories[_i] || {}
      _sum += String(_m.text || '').length + String(_m.title || '').length
    }
    const _avg = _sum / Math.max(1, _n)
    const _cut = Number(process.env.FUSE_VEC_AUTOMIN) || 400
    _autoVecW = _avg < _cut ? 0 : (_N >= 1000 ? 2.0 : 0)
  }
  const wVec = process.env.FUSE_VEC_W !== undefined && process.env.FUSE_VEC_W !== ''
    ? Number(process.env.FUSE_VEC_W)
    : (_autoVecW === null ? (_N >= 1000 ? 1.0 : 0) : _autoVecW)
  // 2026-11-28：默认值改成实测最优（原来 50，实测 40 最好）。
  // 不改的话，用户装完跑的是没调过的那套：T2 3371 会从 95.5/97.0/99.0 掉到 95.0/96.5/98.5。
  const headK = Number(process.env.FUSE_VEC_HEADK) || 40
  const margTh = process.env.FUSE_VEC_MARG !== undefined && process.env.FUSE_VEC_MARG !== ''
    ? Number(process.env.FUSE_VEC_MARG)
    : 0.5   // 2026-11-28：同上，实测 0.5 最好（原 1.0）

  let ranked = [...sc.entries()].sort((a, b) => b[1] - a[1])
  if (wVec > 0 && headK > 1 && opts.vecScores && opts.vecScores.size && ranked.length > 1) {
    // 拿不准才动：前两名分差 / 第一名 < margTh
    const _m = ranked[0][1] > 0 ? (ranked[0][1] - ranked[1][1]) / ranked[0][1] : 1
    if (_m < margTh) {
      const head = ranked.slice(0, headK)
      let tail = ranked.slice(headK)
      const mx = head[0][1] || 1e-9
      // 2026-11-28：试过把「向量前 VC 名」从 tail 提进加分名单，想让字面排到几百名的正解也能吃加分。
      // 实测一分没变（top20 97.5 纹丝不动）——因为那几条正解在我们的向量空间里也进不了前 20。
      // 所以默认关掉（0）。留着代码，换更强的模型时可以再试。
      const VC = Number(process.env.FUSE_VEC_CAND || 0)
      if (VC > 0) {
        const headIds = new Set(head.map((x) => x[0]))
        const vTop = [...opts.vecScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, VC)
        const pull = new Set()
        for (const [id] of vTop) {
          if (!headIds.has(id)) pull.add(id)
        }
        if (pull.size) {
          const moved = []
          const rest = []
          for (const row of tail) {
            if (pull.has(row[0])) moved.push([row[0], 0])
            else rest.push(row)
          }
          if (moved.length) {
            head.push(...moved)
            tail = rest
          }
        }
      }
      const boosted = head.map(([id, v]) => [id, v / mx + wVec * (opts.vecScores.get(id) || 0)])
      boosted.sort((a, b) => b[1] - a[1])
      ranked = boosted.concat(tail)
      // 2026-11-28：前五名锁死，第六名往后让向量补位。
      // 起因：前 20 少捞 5 条，而那几条里向量排第 1 的有三条（修好一个 dot 的 return 之后才看见）。
      // 直接给向量加分挤不进前 20——向量第一名才 0.539，字面前 20 都在 0.85 以上。
      // 所以不抢前五，只补 6~20 名：前五一个字不动，top1/top5 不可能掉，只有召回可能涨。
      const TF = Number(process.env.FUSE_TAIL_FILL || 50)
      if (TF > 0 && opts.vecScores && opts.vecScores.size) {
        const keepN = Math.min(5, ranked.length)
        const head5 = ranked.slice(0, keepN)
        const used = new Set(head5.map((x) => x[0]))
        const rest = ranked.slice(keepN)
        const restById = new Map(rest.map((x) => [x[0], x]))
        const vTop = [...opts.vecScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, TF)
        const fill = []
        for (const [id, s] of vTop) {
          if (used.has(id)) continue
          fill.push([id, (restById.get(id) || [id, 0])[1], s])
        }
        // 补位文档按向量分降序，插在「字面剩下的」前面，但都排在前五之后
        fill.sort((a, b) => b[2] - a[2])
        const fillIds = new Set(fill.map((x) => x[0]))
        const restKept = rest.filter((x) => !fillIds.has(x[0]))
        ranked = head5.concat(fill.map((x) => [x[0], x[1]])).concat(restKept)
      }
    }
  }
  return ranked.slice(0, topk).map((x) => x[0])
}

export function buildIndexes(memories) {
  return { ent: buildEntityIndex(memories), lex: buildLexicalIndex(memories) }
}
