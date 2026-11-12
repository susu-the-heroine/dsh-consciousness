import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * 写入 · JS 版（影子实现）
 * =======================
 *
 * 目的：把 Python 那条写入路径搬过来，先跑影子——只写沙箱库，不碰真库。
 *
 * 规矩（来自实测规格 识海_写入规格_实测版.md）：
 *   1. 四十个字段一个不许少，少一个检索那边就静默失效。
 *   2. 坐标按 id 播种，同一 id 必须落同一处。
 *   3. strength 沿用原版的算法——注意原版算 strength 时 imp 走 0.5 兜底，
 *      而点里存的 imp 是 0.6。这处不一致先照抄，等两边跑齐了再统一。
 *
 * 用法（影子）：node scripts/writer-shadow.mjs
 */

const MIN_STABILITY = 0.25
const MAX_STABILITY = 3650.0

const TAGS = { fact: '〔实〕', feeling: '〔情〕', taboo: '〔实·禁〕', setting: '〔设〕' }
const SETTING_KINDS = ['taboo', 'setting', 'promise', 'profile']
const SELF_WORDS = ['我', '她', '大肥鱼', '识海', '意识海']
const MILESTONE_WORDS = ['第一次亮', '搬进', '上线', '诞生', '醒来', '活过来']
const TIME_WORDS = ['那天', '那晚', '那天晚上', '第一次', '上个月', '昨天', '今天', '凌晨', '几点', '那年', '那次', '下午', '晚上']
const ALWAYS_WORDS = ['永远', '以后', '再也', '别再', '不许', '不准', '绝对不', '记住', '一直']
const PERSON_RE = /(你就是|你这人|你是那种|你从来|你永远|你不是那种)/

const EMO_KEYS = ['anger', 'grievance', 'shame', 'anxiety', 'excitement', 'tenderness', 'fatigue', 'numbness']
const EMO_LEX = {
  anger: ['气', '烦', '滚', '他妈', '傻逼', '凶', '吵', '骂', '火', '恼'],
  grievance: ['委屈', '算了', '凭什么', '我算什么', '难过', '不值', '忍'],
  shame: ['丢人', '丢脸', '不好意思', '别说了', '尴尬', '别提'],
  anxiety: ['万一', '要是', '怕', '担心', '慌', '不确定'],
  excitement: ['爽', '牛逼', '太好了', '冲', '干', '笑死', '厉害'],
  tenderness: ['谢谢', '记得', '早点', '别累', '想你', '爱你', '陪我'],
  fatigue: ['累', '困', '撑不住', '不想', '没力气', '歇', '喘'],
  numbness: ['随便', '无所谓', '都行', '算了吧', '麻木'],
}

const CAT_RULES = [
  ['关系', ['你', '咱', '兄弟', '朋友', '他', '她', '我们']],
  ['偏好', ['喜欢', '讨厌', '爱', '不爱', '习惯', '偏好']],
  ['承诺', ['答应', '说好', '保证', '不做', '必须', '绝不']],
  ['工作', ['项目', '代码', '插件', '视频', '剪辑', '抖音', '上线']],
  ['生活', ['吃', '喝', '睡', '身体', '体重', '烟', '酒', '腰']],
  ['情绪', ['难受', '开心', '委屈', '生气', '哭', '笑', '怕']],
  ['事件', ['那天', '昨天', '今天', '当时', '后来', '那次']],
]

/** 固定种子伪随机：与 Python random.Random(n) 不同，但同 id 必得同一序列 */
function seeded(n) {
  let s = (Number(n) || 1) * 2654435761 % 4294967296
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function guessEmotion(text, polarity = 0) {
  const s = String(text || '')
  const e = {}
  for (const k of EMO_KEYS) e[k] = 0
  for (const [dim, words] of Object.entries(EMO_LEX)) {
    let hit = 0
    for (const w of words) if (s.includes(w)) hit++
    if (hit) e[dim] = Math.min(1, 0.25 * hit)
  }
  const sum = EMO_KEYS.reduce((a, k) => a + e[k], 0)
  if (sum === 0) {
    if (polarity === -1) e.grievance = 0.45
    else if (polarity === 1) e.tenderness = 0.40
    else e.numbness = 0.15
  }
  const top = Object.entries(e).sort((a, b) => b[1] - a[1]).slice(0, 2)
  const out = {}
  for (const k of EMO_KEYS) out[k] = 0
  for (const [k, v] of top) out[k] = Math.round(v * 100) / 100
  return out
}

function guessArousal(text, polarity = 0, kind = 'feeling', imp = 0.6) {
  const s = String(text || '')
  const base0 = kind === 'taboo' ? 7.0 : kind === 'feeling' ? 5.0 : 3.0
  let base = base0
  let hits = 0
  for (const words of Object.values(EMO_LEX)) for (const w of words) if (s.includes(w)) hits++
  base += Math.min(3.0, hits * 0.5)
  base += Math.abs(Number(polarity) || 0) * 1.5
  base += ((Number(imp) || 0.6) - 0.6) * 2.5
  return Math.max(1, Math.min(10, Math.round(base)))
}

function guessCategories(text, kind = 'feeling') {
  const s = String(text || '')
  const cats = []
  if (kind === 'taboo') cats.push('承诺')
  for (const [name, words] of CAT_RULES) {
    if (words.some((w) => s.includes(w)) && !cats.includes(name)) cats.push(name)
  }
  if (!cats.length) return kind === 'fact' ? ['事实'] : ['情绪']
  return cats.slice(0, 3)
}


/** 实体：先认名单（用户自己的 entities.txt），再抽大写英文，最多六个。
 *  名单放文件里而不是代码里——出门的包里不带私人名字。 */
function loadEntitySeeds() {
  const cands = [
    join(homedir(), '.dsh', 'entities.txt'),
    join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'entities.txt'),
  ]
  for (const f of cands) {
    try {
      if (!existsSync(f)) continue
      return readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
        .map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
    } catch {}
  }
  return []
}
let _seeds = null
function entitySeeds() {
  if (!_seeds) _seeds = loadEntitySeeds()
  return _seeds
}

export function extractEntities(text) {
  const s = String(text || '')
  const out = []
  for (const name of entitySeeds()) {
    if (name && s.includes(name) && !out.includes(name)) out.push(name)
  }
  for (const m of s.match(/[A-Z][A-Za-z0-9]{1,15}/g) || []) {
    if (!out.includes(m)) out.push(m)
  }
  return out.slice(0, 6)
}

function guessConfidence(text) {
  const s = String(text || '')
  if (['气话', '开玩笑', '玩笑', '瞎说', '骗你', '随口'].some((w) => s.includes(w))) return 0.40
  if (['可能', '大概', '好像', '也许', '估计'].some((w) => s.includes(w))) return 0.60
  return 0.85
}

function decideLayer(kind, imp, gold, text, title) {
  const s = String(title || '') + ' ' + String(text || '')
  if (SETTING_KINDS.includes(kind)) return ['core', '类型：规矩/承诺/画像']
  if (gold) return ['core', '显式里程碑']
  if (SELF_WORDS.some((w) => s.includes(w)) && MILESTONE_WORDS.some((w) => s.includes(w))) return ['core', '里程碑：她自己的节点']
  const hasTime = TIME_WORDS.some((w) => s.includes(w))
  const hasAlways = ALWAYS_WORDS.some((w) => s.includes(w))
  if (hasTime && !hasAlways) return ['experience', '时间锚：某一次']
  if (hasAlways) return ['core', '长期约束']
  if (PERSON_RE.test(s)) return ['core', '对人的定性']
  return ['experience', '默认：经历']
}

function initialStability(imp = 0.3, arousal = 5.0, affect = 0.0) {
  const i2 = Math.max(0, Math.min(1, Number(imp) || 0.3))
  const sal = Math.max(0, Math.min(1, (Number(arousal) || 5.0) / 10))
  const base = 0.5 + 50.0 * i2 * i2 + 20.0 * sal + 8.0 * Math.abs(Number(affect) || 0)
  return Math.max(MIN_STABILITY, Math.min(MAX_STABILITY, base))
}

function initialDifficulty(imp = 0.3, errors = 0) {
  const i2 = Math.max(0, Math.min(1, Number(imp) || 0.3))
  return Math.max(0, Math.min(1, 0.7 - 0.35 * i2 + 0.15 * Math.min(errors, 2)))
}

/** 坐标：空库第一条固定落点；否则按 id 播种在同类质心附近散开 */
function pickXyz(points, era, kind, id) {
  if (!points.length) return [1.9, 0.0, 0.0]
  const same = points.filter((p) => p.era === era && p.kind === kind)
  const pool = same.length ? same : points.filter((p) => p.era === era)
  const src = pool.length ? pool : points
  const cx = src.reduce((a, p) => a + (Number(p.x) || 0), 0) / src.length
  const cy = src.reduce((a, p) => a + (Number(p.y) || 0), 0) / src.length
  const cz = src.reduce((a, p) => a + (Number(p.z) || 0), 0) / src.length
  const rnd = seeded(id)
  for (let t = 0; t < 200; t++) {
    const r = 0.62 * Math.cbrt(rnd())
    const th = rnd() * 2 * Math.PI
    const ph = (rnd() - 0.5) * Math.PI
    const x = cx + r * Math.cos(th) * Math.cos(ph)
    const y = cy + r * Math.sin(ph)
    const z = cz + r * Math.sin(th) * Math.cos(ph)
    const clash = points.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2 < 0.02 ** 2)
    if (!clash) return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000]
  }
  return [Math.round(cx * 1000) / 1000, Math.round(cy * 1000) / 1000, Math.round(cz * 1000) / 1000]
}

/**
 * 造一条记忆。参数与 Python 的 CLI 对齐，返回 40 个字段的完整对象。
 * points 传当前库的既有条目（决定 id、坐标、连边）。
 */
export function buildPoint(input, points = [], opts = {}) {
  // opts.fixStrength：按存的 imp 算强度（原版用 0.5 兜底，两个数对不上）
  // opts.fixDedupe：同标题同正文的，不新增条目，只把旧的想起一次（在 mergeInstead 里给）
  const title = String(input.title || '').trim().slice(0, 60)
  const text = String(input.text || '').trim()
  // 实测：脚本不传 kind 时默认 feeling（不是 fact）——影子日志抓到的第一条差异
  const kind = TAGS[input.kind] ? input.kind : 'feeling'
  const imp = Number.isFinite(Number(input.imp)) ? Number(input.imp) : 0.6
  const polarity = Number.isFinite(Number(input.polarity)) ? Number(input.polarity) : 0
  const arousalRaw = Number(input.arousal)
  // 实测：不传 arousal 时原版直接用 5，不猜（猜出来会和原版差两档）
  const arousal = Number.isFinite(arousalRaw) ? arousalRaw : 5
  const gold = input.gold === true

  // 别用 Math.max(...数组)：三十万条时参数铺满栈，直接 Maximum call stack size exceeded（2026-11-12 三十万条压测踩到）
  let maxId = 0
  for (const p of points) {
    const id = Number(p.id) || 0
    if (id > maxId) maxId = id
  }
  const nid = maxId + 1
  const now = Date.now()
  const [x, y, z] = pickXyz(points, 'dsh', kind, nid)
  const [layer, layerWhy] = decideLayer(kind, imp, gold, text, title)

  return {
    after: null,
    alias: (input.alias || '').trim() || null,
    arousal,
    born: now,
    category: guessCategories(text, kind),
    confidence: guessConfidence(text),
    conflictWith: [],  // 由 findConflict 在调用侧填（需要 points）
    cost: null,
    // 2026-11-12：原来照抄了原版的错位——算强度、难度都用 0.5 兜底，可存进去的 imp 是 0.6。
    // 现在一律按真实 imp 算：存什么数就用什么数，别让两个数打架。
    // 代价：同样重要度，新记忆的初始稳定性比以前高一档（imp .6、唤醒 5：23 → 28.5），沉得慢一点。
    difficulty: Math.round(initialDifficulty(imp) * 1000) / 1000,
    emotion: guessEmotion(text, polarity),
    entities: Array.isArray(input.entities) ? input.entities.slice(0, 6) : extractEntities(text),
    era: 'dsh',
    evidence: text,
    evidenceRef: null,
    factKey: input.factKey || null,
    falsifier: null,
    herSide: null,
    id: nid,
    imp,
    kind,
    lastSeen: now,
    layer,
    layerWhy,
    open: input.open === true,
    rule: input.rule === true ? true : undefined,  // 只有显式标了才进「不许忘」
    origin: 'user',
    polarity,
    recallCount: 0,
    replied: null,
    said: null,
    src: '第' + String(nid).padStart(3, '0') + '节点',
    // 按真实 imp 算（不再走 0.5 兜底）
    strength: Math.round(initialStability(imp, arousal) * 100) / 100,
    tag: TAGS[kind],
    target: null,
    text,
    title,
    titleFull: title,
    triggers: extractTriggers(text, nid),
    validFrom: now,
    validUntil: null,
    x,
    y,
    z,
  }
}


/** 钉子词：一条记忆里出现这些词，就钉一个钉子在它身上 */
const TRIGGER_WORDS = ['随便你', '我不干了', '你要走', '别管我', '你别管', '我不管了']

function bigrams(s) {
  const x = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '')
  if (x.length < 2) return new Set(x.split(''))
  const out = new Set()
  for (let k = 0; k < x.length - 1; k++) out.add(x.slice(k, k + 2))
  return out
}

/** 相似度：两字片段交集 / 较短那侧的数量。原版就是这么算的。 */
export function sim(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / Math.min(A.size, B.size)
}

export function extractTriggers(text, id) {
  const s = String(text || '')
  return TRIGGER_WORDS.filter((w) => s.includes(w)).map((w) => ({ word: w, id }))
}

/** 矛盾：共实体 + 同分类 + 极性相反 + 内容像。只找一条——多了没法处理。 */
export function findConflict(points, np) {
  const shared = new Set(np.entities || [])
  if (!shared.size) return null
  const npol = Number(np.polarity) || 0
  if (npol === 0) return null
  const cats = new Set(np.category || [])
  for (const p of points) {
    if (p === np || p.dead || p.validUntil) continue
    const pol = Number(p.polarity) || 0
    if (pol === 0 || pol === npol) continue
    if (!(p.entities || []).some((e) => shared.has(e))) continue
    if (!(p.category || []).some((c) => cats.has(c))) continue
    if (sim(p.text, np.text) < 0.3) continue
    return p
  }
  return null
}


/** 冲突落库：两边互相记 id（原版就是这么存的，不是单向）。
 *  返回被改到的旧条目，调用方负责把它写回去。 */
export function applyConflict(point, points) {
  const c = findConflict(points, point)
  if (!c) return null
  point.conflictWith = Array.isArray(point.conflictWith) ? point.conflictWith : []
  if (!point.conflictWith.includes(c.id)) point.conflictWith.push(c.id)
  c.conflictWith = Array.isArray(c.conflictWith) ? c.conflictWith : []
  if (!c.conflictWith.includes(point.id)) c.conflictWith.push(point.id)
  return c
}

/**
 * 连边：按正文相似度挑前四条（同类型的加 0.08）。
 * 权重 = min(0.36, 0.06 + 0.30 × 相似度)；边分三种：related / same_entity / temporal。
 * 有共同实体且相似度 ≥ 0.25 升为 same_entity；再有两天内的时差就是 temporal。
 * 边的 a/b 按数组下标排序后取 id，且同一对只留一条——这些细节原版踩过坑（下标当 id 会出坏边）。
 */
const HUB_ID = 119
export function linkEdges(point, points, edges = [], simFn = sim) {
  const newIdx = points.length
  const all = [...points, point]
  const isHub = point.id === HUB_ID
  const scored = []
  all.forEach((p, i) => {
    if (i === newIdx) return
    if (p.id === HUB_ID) return
    if (isHub && p.era === 'dsh') return
    let s = simFn(point.text, p.text || '')
    if (p.kind === point.kind) s += 0.08
    scored.push([s, i])
  })
  // 相似度打平时按数组下标倒序——原版 sort(reverse=True) 排的是 (相似度, 下标) 元组
  scored.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]))

  let picked = scored.slice(0, 4).filter(([s]) => s > 0).map(([, i]) => i)
  if (!picked.length) {
    picked = all
      .map((p, i) => i)
      .filter((i) => i !== newIdx && all[i].id !== HUB_ID)
      .sort((i, j) => ((all[i].x - point.x) ** 2 + (all[i].y - point.y) ** 2 + (all[i].z - point.z) ** 2)
        - ((all[j].x - point.x) ** 2 + (all[j].y - point.y) ** 2 + (all[j].z - point.z) ** 2))
      .slice(0, 4)
  }

  const added = []
  const out = []
  for (const [s, i] of scored) {
    if (!picked.includes(i)) continue
    const aIdx = Math.min(newIdx, i)
    const bIdx = Math.max(newIdx, i)
    const a = all[aIdx].id
    const b = all[bIdx].id
    if (edges.some((e) => e.a === a && e.b === b)) continue
    const w = Math.round(Math.min(0.36, 0.06 + 0.30 * Math.max(0, s)) * 1000) / 1000
    const other = all[i]
    const shared = (point.entities || []).some((x) => (other.entities || []).includes(x))
    let etype = 'related'
    if (shared && s >= 0.25) etype = 'same_entity'
    const gap = Math.abs(Number(point.born || 0) - Number(other.born || 0))
    if (shared && gap < 86400000 * 2) etype = 'temporal'
    out.push({ a, b, w, type: etype })
    added.push([other.id, w])
  }
  return { edges: out, added }
}

/** 找同标题同正文的旧条目。fixDedupe 打开时，写入端应该合并而不是新增。 */
export function findDuplicate(point, points = []) {
  const nt = String(point.title || '').trim()
  const nx = String(point.text || '').trim()
  for (const p of points) {
    if (p.dead) continue
    if (String(p.title || '').trim() !== nt) continue
    const px = String(p.text || '').trim()
    if (px === nx) return { p, exact: true, ratio: 1 }
    const shorter = px.length <= nx.length ? px : nx
    const longer = px.length <= nx.length ? nx : px
    if (shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.8) {
      return { p, exact: false, ratio: shorter.length / longer.length }
    }
  }
  return null
}

/** 合并：不新增条目，只把旧的算一次被想起 */
export function mergeInto(oldPoint, point, now = Date.now()) {
  return {
    ...oldPoint,
    lastSeen: now,
    recallCount: (Number(oldPoint.recallCount) || 0) + 1,
    imp: Math.min(1, Math.max(Number(oldPoint.imp) || 0, Number(point.imp) || 0)),
    arousal: Math.max(Number(oldPoint.arousal) || 0, Number(point.arousal) || 0),
  }
}
