/**
 * 想事情有哪几种动作——一张表，十种。
 *
 * 铁律（2026-11-11 批量测完定的）：
 *   每种动作必须从那条记忆里抠出一个具体的东西——一句话、一个数、一个人名，
 *   塞进问句里。抠不出来就不开这个动作。
 *
 * 为什么定这条：第一版十种动作，批量测 52 个词，75% 的问句是空话
 * （"要是这件事再重复三次会怎样"），跟具体记忆没关系，谁都能说。
 * 宁可只开两种，不要六种空话。
 *
 * 另一条：输出的是"该问的问题"，不是结论。结论得由会写字的那层来写。
 */

const STOP = new Set(['那次', '这次', '那个', '这个', '我们', '你们', '他们', '什么', '怎么', '一下', '其实', '自己', '但是', '所以', '然后'])

const textOf = (p) => String((p && p.title) || '') + ' ' + String((p && p.text) || '')

function entsOf(p) {
  const raw = Array.isArray(p && p.entities) ? p.entities : []
  return raw.map((x) => String(x).trim()).filter((x) => x.length >= 2 && !STOP.has(x))
}

function catsOf(p) {
  return Array.isArray(p && p.category) ? p.category.map(String) : []
}

const aliveOf = (points) => (Array.isArray(points) ? points : []).filter((p) => p && !p.dead && !p.archived)

const item = (p, why) => p ? ({
  id: p.id,
  title: String(p.title || '').slice(0, 40),
  text: String(p.text || '').replace(/\s+/g, ' ').slice(0, 90),
  why,
}) : null

function dfMap(alive) {
  const df = new Map()
  for (const p of alive) for (const e of entsOf(p)) df.set(e, (df.get(e) || 0) + 1)
  const cap = Math.max(3, Math.round(alive.length * 0.2))
  return { df, cap }
}

/* ───────── 从记忆里抠具体东西 ───────── */

/** 抠一句话：按标点切开，取最长的那个短语（8~26 字最像"一句现场"） */
function quoteOf(p) {
  const t = String((p && p.text) || '')
  const parts = t.split(/[，。！？；：、\n\r]/).map((x) => x.trim()).filter((x) => x.length >= 8 && x.length <= 26)
  if (!parts.length) return ''
  parts.sort((a, b) => b.length - a.length)
  return parts[0]
}

/** 中文数字转数：八 → 8、十二 → 12、二十 → 20、两百 → 200。认不出返回 NaN */
function cn2num(s) {
  const t = String(s || '')
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  const d = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let total = 0
  let cur = 0
  for (const ch of t) {
    if (d[ch] !== undefined) cur = d[ch]
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0 }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0 }
    else return NaN
  }
  return total + cur
}

/** 抠一个带单位的数：几天、几个小时、几条、几块 */
function numOf(p) {
  const t = textOf(p)
  // 2026-11-20：原来只认阿拉伯数字，库里写「八天吊针」「三回」这种中文数字，这个动作永远开不了。
  // 先试阿拉伯数字，不行再试中文数字。
  const m = t.match(/(\d+(?:\.\d+)?)\s*(天|小时|分钟|年|个月|次|条|块|行|个|遍|斤|公斤|公里|米|元|岁|页|万|秒)/)
  if (m) return { n: m[1], unit: m[2], text: m[0] }
  const m2 = t.match(/([零一二三四五六七八九十百两]+)\s*(天|小时|分钟|年|个月|次|条|块|行|个|遍|斤|公斤|公里|米|元|岁|页|万|秒)/)
  if (!m2) return null
  return { n: m2[1], unit: m2[2], text: m2[0], v: cn2num(m2[1]) }
}

/** 抠这条记忆里最"专属"的实体（全库出现最少的那个） */
function rareEnt(p, df) {
  const es = entsOf(p)
  if (!es.length) return ''
  es.sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0))
  return es[0]
}

/** 含"该怎么/不该"的那句判断 */
function claimOf(p) {
  const t = String((p && p.text) || '')
  const parts = t.split(/[。！？\n\r]/).map((x) => x.trim()).filter((x) => x.length >= 6 && x.length <= 40)
  // 2026-11-20：原来单字「别」「要」裸着判——「今天没什么特别的」里的「别」也算一条硬判断，
  // 于是打开一个「反过来做，不照『今天没什么特别的』来」——正是这文件头注释骂的那种空话。
  // 「要」同理：只要、重要、主要都会误伤。给这两个字加前一个字的前置条件。
  const hit = parts.find((x) => /必须|不许|不能|该|(?<![特分区别类道告级])别|(?<![只需重主次必])要/.test(x))
  return hit || ''
}

/** 含"还差/没做/还没"的那句 */
function gapOf(p) {
  const t = String((p && p.text) || '')
  const parts = t.split(/[。！？\n\r]/).map((x) => x.trim()).filter((x) => x.length >= 6 && x.length <= 40)
  const hit = parts.find((x) => /缺|没做|还没|待|下一步|差|剩下/.test(x))
  return hit || ''
}

/* ───────── 十种动作 ─────────
 * 每种都在 run 里先把"具体东西"抠出来；抠不到就抛错，主入口当作没开。
 */
const OPS = {

  swap: {
    label: '换变量',
    cost: 1,
    run(c) {
      const v = c.variants[0]
      if (!c.noun || !v) throw 0
      return {
        ask: '把「' + c.noun + '」换成「' + v.word + '」，会怎么样',
        items: [item(c.self, '说的就是「' + c.noun + '」'), item(v.p, '「' + v.word + '」是从这儿来的')],
      }
    },
  },

  compare: {
    label: '比较',
    cost: 1,
    run(c) {
      const v = c.variants[0]
      if (!c.noun || !v) throw 0
      return {
        ask: '「' + c.noun + '」和「' + v.word + '」，哪个更好',
        items: [item(c.self, '一边'), item(v.p, '另一边')],
      }
    },
  },

  extrapolate: {
    label: '外推',
    cost: 2,
    run(c) {
      const num = c.self && numOf(c.self)
      if (!num) throw 0
      // 2026-11-20：中文数字（八天）不能 Number()，那会算出 NaN，问句变成「变成 NaN天」。
      const _n = Number.isFinite(Number(num.v)) ? Number(num.v) : Number(num.n)
      const twice = String(Number.isFinite(_n) ? _n * 2 : num.n + num.n)
      return {
        ask: '现在是 ' + num.text + '，要是变成 ' + twice + num.unit + '，会怎样',
        items: [item(c.self, '这条里写着 ' + num.text)],
      }
    },
  },

  attribute: {
    label: '归因',
    cost: 2,
    run(c) {
      const q = c.self && quoteOf(c.self)
      if (!q) throw 0
      return {
        ask: '「' + q + '」——为什么会走到这一步',
        items: [item(c.self, '原话在这儿')],
      }
    },
  },

  reverse: {
    label: '反向',
    cost: 2,
    run(c) {
      const q = c.self && claimOf(c.self)
      if (!q) throw 0
      return {
        ask: '反过来做，不照「' + q + '」来，会坏在哪儿',
        items: [item(c.self, '这里有一条硬判断')],
      }
    },
  },

  gap: {
    label: '缺环',
    cost: 2,
    run(c) {
      const q = c.self && gapOf(c.self)
      if (!q) throw 0
      return {
        ask: '「' + q + '」——缺的那一环库里有没有',
        items: [item(c.self, '这里写着没做完的地方')],
      }
    },
  },

  extreme: {
    label: '极端化',
    cost: 2,
    run(c) {
      const num = c.self && numOf(c.self)
      if (!num) throw 0
      return {
        ask: '把 ' + num.text + ' 推到极限，最先崩的是哪一块',
        items: [item(c.self, '这条里有个量')],
      }
    },
  },

  combine: {
    label: '组合',
    cost: 2,
    run(c) {
      const pr = c.pair
      if (!pr || !pr.a || !pr.b) throw 0
      const qa = quoteOf(pr.a) || rareEnt(pr.a, c.df)
      const qb = quoteOf(pr.b) || rareEnt(pr.b, c.df)
      if (!qa || !qb) throw 0
      return {
        ask: '「' + qa + '」和「' + qb + '」放一起，能长出什么',
        items: [item(pr.a, '连着的是「' + (pr.why || '') + '」'), item(pr.b, '另一头')],
      }
    },
  },

  analogy: {
    label: '类比',
    cost: 3,
    run(c) {
      const pr = c.pair
      if (!pr || !pr.a || !pr.b) throw 0
      const ea = rareEnt(pr.a, c.df), eb = rareEnt(pr.b, c.df)
      if (!ea || !eb) throw 0
      return {
        ask: '「' + ea + '」这件事和「' + eb + '」这件事，是不是一个道理',
        items: [item(pr.a, '题材不同'), item(pr.b, '靠「' + (pr.why || '') + '」连上')],
      }
    },
  },

  abstract: {
    label: '抽象',
    cost: 3,
    run(c) {
      const cl = c.cluster
      if (!cl || cl.length < 3) throw 0
      const quotes = cl.map((p) => quoteOf(p)).filter(Boolean)
      if (quotes.length < 3) throw 0
      return {
        ask: '「' + quotes[0].slice(0, 14) + '」「' + quotes[1].slice(0, 14) + '」「' + quotes[2].slice(0, 14) + '」——三件说的是同一个什么',
        items: cl.slice(0, 4).map((p) => item(p, '同一类里的')),
      }
    },
  },
}

// 每种动作"该问哪一类问题"——只给方向，不拼句子。
// 模板拼出来的问句是假的（测出 60% 空话），句子留给会写字的那层。2026-11-11。
const HINTS = {
  swap: '换成另一个同类，会比现在好吗',
  compare: '两个同类摆一起，哪个更值',
  extrapolate: '把里面的量推大，会先坏在哪',
  attribute: '这件事的真正原因，是不是写下来的那个',
  reverse: '反着做会怎样',
  gap: '还差的那一环，库里有没有',
  extreme: '推到极限还剩什么',
  combine: '这两件放一起能长出什么',
  analogy: '这两件是不是同一个道理',
  abstract: '这几件凑在一起，共性是哪个',
}

export const OP_NAMES = Object.keys(OPS)
export const OP_TABLE = OP_NAMES.map((k) => ({ op: k, label: OPS[k].label, cost: OPS[k].cost }))

/* ───────── 材料 ───────── */

/** 同类项：只在实体里找，长度接近，不算"把原词塞进更长的词" */
function findVariants(alive, noun) {
  const out = []
  if (!noun || noun.length < 2) return out
  const seen = new Set([noun])
  const n = noun.length
  for (const p of alive) {
    for (const e of entsOf(p)) {
      if (e === noun || seen.has(e)) continue
      if (Math.abs(e.length - n) > 1) continue
      if (e.includes(noun) || noun.includes(e)) continue
      if (e.slice(-1) !== noun.slice(-1) && e.slice(0, 2) !== noun.slice(0, 2)) continue
      seen.add(e)
      out.push({ word: e, p })
      if (out.length >= 6) return out
    }
  }
  return out
}

function pickPairWith(alive, seed, df, cap) {
  const es = entsOf(seed).filter((e) => (df.get(e) || 0) <= cap)
  for (const e of es) {
    const other = alive.find((p) => p.id !== seed.id && entsOf(p).includes(e) && catsOf(p).join() !== catsOf(seed).join())
    if (other) return { a: seed, b: other, why: e }
  }
  return null
}

/** 抽象要凑三条，但必须跟种子沾边。
 *  早先是全库随手挑三条同类，批量测出 19 条跟种子毫无关系。2026-11-11 改。
 */
function pickCluster(alive, seed, noun, df, cap) {
  if (!seed) return []
  const seedEnts = new Set(entsOf(seed).filter((e) => (df.get(e) || 0) <= cap))
  const room = alive.filter((p) => {
    if (p.id === seed.id) return false
    const s = textOf(p)
    if (noun && s.includes(noun)) return true
    return entsOf(p).some((e) => seedEnts.has(e))
  })
  if (room.length < 2) return []
  const picked = room.slice(0, 3)
  return [seed, ...picked]
}

/* ───────── 主入口 ───────── */

/**
 * @param points 全部记忆
 * @param input  { query?: 一个词, id?: 某条记忆 }
 * @param opt    { max: 最多开几种 }
 */
export function think(points, input = {}, opt = {}) {
  const alive = aliveOf(points)
  const { df, cap } = dfMap(alive)
  const max = Math.max(1, Math.min(10, opt.max || 4))

  let self = null
  const noun = String(input.query || '').trim()
  if (input.id != null) self = alive.find((p) => String(p.id) === String(input.id)) || null
  if (!self && noun) self = alive.find((p) => textOf(p).includes(noun)) || null

  const ctx = {
    self, noun, df, cap,
    variants: findVariants(alive, noun),
    cluster: pickCluster(alive, self, noun, df, cap),
    pair: self ? pickPairWith(alive, self, df, cap) : null,
  }

  const out = []
  const skipped = []
  const order = OP_NAMES.slice().sort((a, b) => OPS[a].cost - OPS[b].cost)
  for (const name of order) {
    if (out.length >= max) { skipped.push(OPS[name].label); continue }
    try {
      const r = OPS[name].run(ctx)
      const items = (r && r.items || []).filter(Boolean)
      if (!items.length) throw 0          // 连材料都没有，就是空的
      out.push({ op: name, label: OPS[name].label, hint: HINTS[name] || '', items })
    } catch {
      skipped.push(OPS[name].label)
    }
  }

  return {
    seed: noun || (self ? String(self.title || '') : ''),
    opened: out.map((x) => x.label),
    closed: skipped,
    ops: out,
  }
}
