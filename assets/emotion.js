/**
 * 情绪系统 · emotion.js
 * ======================
 *
 * 借的：
 *   · 31 种情绪、PAD 三维、半衰期、触发条件 —— 来自 dsh-memory-net（MIT）的 lib/emotion.mjs
 *   · PAD 三维本身是 Mehrabian 1974
 *   · 11 维评价值（novelty/relevance/conduciveness/expectation/certainty/control/normFit/urgency/care/energy/agency）—— OCC + SEC
 *
 * 改的（这才是超越）：
 *   1. 不用它那 30 条中文正则。我有模型，让模型打 11 维比堆词表准。
 *      这里只留一层「便宜的兜底规则」，模型不可用时也能跑。
 *   2. 把 herSide（她自己的感受）接进来当一条评价值。
 *      别的系统里，情绪是「对事件的反应」；这里情绪是「对记忆的反应」——
 *      一条记忆带着她当时的感觉，重新读它，那感觉会回来。
 *   3. 常数不手调，用真数据标定（见 CALIBRATION）。
 *
 * 核心区别：
 *   旧版是「六状态」，一次只能是一种。
 *   人是同时有好几种的：一边烦一边舍不得，一边得意一边心虚。
 *   所以这里是 mix —— 多情绪并行，各自半衰，互相压制或扶持。
 */

// ---------------------------------------------------------------------------
// 31 种情绪
// p = [效价 v, 唤醒 a, 掌控 d]  half = 半衰期（分钟）
// ---------------------------------------------------------------------------

export const EMOTIONS = {
  // —— 强烈负性，带攻击性 ——
  fierce:   { label: '炸毛护人',   p: [-0.40, 0.80, 0.55], half: 25 },
  angry:    { label: '生气',       p: [-0.55, 0.65, 0.45], half: 35 },
  disdain:  { label: '看不上',     p: [-0.30, 0.45, 0.50], half: 70 },
  jealous:  { label: '酸',       p: [-0.42, 0.42, -0.32], half: 40 },
  disgusted:{ label: '嫌',         p: [-0.60, 0.35, 0.20], half: 60 },

  // —— 负性，往下沉 ——
  hurt:     { label: '委屈',       p: [-0.50, 0.15, -0.40], half: 90 },
  sad:      { label: '难过',       p: [-0.60, -0.30, -0.35], half: 180 },
  lonely:   { label: '孤独',       p: [-0.55, -0.20, -0.45], half: 150 },
  dejected: { label: '提不起劲',   p: [-0.80, -0.35, -0.70], half: 240 },
  guilty:   { label: '愧疚',       p: [-0.45, 0.10, -0.50], half: 200 },
  ashamed:  { label: '羞耻',       p: [-0.65, 0.30, -0.60], half: 360 },
  numb:     { label: '麻木',       p: [-0.20, -0.50, -0.20], half: 480 },
  drained:  { label: '空了',       p: [-0.45, -0.35, -0.45], half: 300 },
  tired:    { label: '累',         p: [-0.25, -0.50, -0.20], half: 240 },
  bored:    { label: '没意思',     p: [-0.20, -0.45, -0.05], half: 180 },

  // —— 焦虑族 ——
  anxious:  { label: '焦虑',       p: [-0.45, 0.60, -0.55], half: 60 },
  nervous:  { label: '紧张',       p: [-0.35, 0.65, -0.45], half: 35 },
  scared:   { label: '怕',         p: [-0.60, 0.75, -0.65], half: 45 },
  impatient:{ label: '急得不行',   p: [-0.25, 0.72, -0.15], half: 25 },
  restless: { label: '坐不住',     p: [-0.05, 0.62, -0.30], half: 45 },
  worried:  { label: '惦记',       p: [-0.30, 0.35, -0.30], half: 240 },
  tense:    { label: '心里不踏实',       p: [-0.35, 0.50, -0.10], half: 1440 }, // 一天退一半：很顽固，但不会永远僵着
                                                                            // （原来 999 = 代码里直接跳过衰减，别人装上会永久绷住）

  // —— 正性 ——
  joy:      { label: '高兴',       p: [0.75, 0.60, 0.35], half: 45 },
  happy:    { label: '轻快',       p: [0.60, 0.55, 0.30], half: 60 },
  moved:    { label: '感动',       p: [0.55, 0.35, -0.10], half: 70 },
  eager:    { label: '迫不及待',   p: [0.55, 0.72, 0.22], half: 30 },
  curious:  { label: '好奇',       p: [0.45, 0.58, -0.05], half: 40 },
  proud:    { label: '得意',       p: [0.55, 0.45, 0.65], half: 40 },
  shy:      { label: '害臊',       p: [0.35, 0.40, -0.35], half: 35 },
  soft:     { label: '心软',       p: [0.45, -0.15, 0.05], half: 80 },
  calm:     { label: '满足',       p: [0.40, -0.30, 0.30], half: 100 },
  fond:     { label: '亲近',       p: [0.55, -0.05, 0.20], half: 300 },

  // ——— 下面这批是中文特有，英语情绪表里没有对应的单个词 ———
  // 硬翻成英文会丢东西，所以直接按中文的语感给 PAD。
  sour:     { label: '酸',         p: [-0.35, 0.20, -0.30], half: 120 },  // 看别人好，自己心里发涩
  queasy:   { label: '膈应',       p: [-0.50, 0.25, -0.15], half: 90 },   // 不是恶心，是脏了一下
  jittery:  { label: '发虚',       p: [-0.30, 0.45, -0.45], half: 50 },   // 心虚，底气不足
  heady:    { label: '上头',       p: [0.35, 0.85, -0.10], half: 20 },    // 冲动了，收不住
  stuffed:  { label: '堵得慌',     p: [-0.45, 0.30, -0.35], half: 150 },  // 有话说不出来
  tastebad: { label: '不是滋味',   p: [-0.30, 0.15, -0.20], half: 180 },  // 说不上难受，就是不舒坦
  hollow:   { label: '心里空',     p: [-0.40, -0.35, -0.30], half: 240 },
  pumped:   { label: '来劲',       p: [0.55, 0.75, 0.50], half: 35 },
  pent:     { label: '憋着',       p: [-0.35, 0.55, -0.25], half: 200 },  // 忍着不发
  light:    { label: '松快',       p: [0.50, -0.25, 0.35], half: 90 },
  concede:  { label: '服气',       p: [0.20, -0.10, -0.15], half: 240 },  // 认了，但不甘心
  defy:     { label: '不服',       p: [-0.25, 0.50, 0.40], half: 120 },
  lucky:    { label: '侥幸',       p: [0.25, 0.30, -0.10], half: 80 },
  sore:     { label: '心疼',       p: [-0.40, 0.20, -0.20], half: 180 },
  dread:    { label: '犯怵',       p: [-0.50, 0.50, -0.50], half: 70 },
  awkward:  { label: '抹不开',     p: [-0.15, 0.25, -0.35], half: 60 },
  bittersweet:{ label: '又甜又苦', p: [0.10, 0.10, -0.10], half: 300 },
  resigned: { label: '算了',       p: [-0.25, -0.30, -0.20], half: 300 },
  stung:    { label: '扎心',       p: [-0.55, 0.35, -0.30], half: 240 },
}

// ---------------------------------------------------------------------------
// 相克：强的吃掉弱的
// 记忆网的手调表在这，但系数重标过 —— 它 0.9 太狠，一次就能清场。
// ---------------------------------------------------------------------------

const CLASH = [
  // 正性压负性
  ['joy', 'sad'], ['joy', 'hurt'], ['joy', 'lonely'], ['joy', 'dejected'],
  ['joy', 'angry'], ['joy', 'irritated'], ['joy', 'anxious'], ['joy', 'tired'],
  ['happy', 'sad'], ['happy', 'hurt'], ['happy', 'angry'], ['happy', 'tired'],
  ['moved', 'disdain'], ['moved', 'angry'], ['moved', 'hurt'],
  ['calm', 'anxious'], ['calm', 'restless'], ['calm', 'impatient'], ['calm', 'angry'],
  ['soft', 'fierce'], ['soft', 'angry'], ['fond', 'lonely'],
  ['proud', 'ashamed'], ['proud', 'guilty'],
  // 负性压正性（生气的时候高兴不起来，这方向也要有）
  ['angry', 'joy'], ['angry', 'eager'], ['angry', 'happy'],
  ['scared', 'joy'], ['scared', 'proud'], ['scared', 'eager'],
  ['hurt', 'joy'], ['hurt', 'proud'],
  ['ashamed', 'proud'], ['ashamed', 'eager'],
  ['sad', 'joy'], ['sad', 'eager'],
  // 麻木吃掉一切
  ['numb', 'joy'], ['numb', 'sad'], ['numb', 'angry'], ['numb', 'anxious'],
]

const CLASH_SET = new Set()
for (const [a, b] of CLASH) { CLASH_SET.add(a + '|' + b); CLASH_SET.add(b + '|' + a) }

export function clashes(a, b) { return CLASH_SET.has(a + '|' + b) }

// 相近：互相喂
const KIN = {
  joy: ['happy', 'eager', 'proud'],
  happy: ['calm', 'soft', 'fond'],
  sad: ['hurt', 'lonely', 'dejected'],
  hurt: ['guilty', 'lonely'],
  anxious: ['nervous', 'worried', 'restless'],
  nervous: ['scared', 'impatient'],
  angry: ['fierce', 'disdain'],
  fond: ['soft', 'moved'],
  tired: ['drained', 'numb'],
  tense: ['worried', 'anxious'],
}

const KIN_SET = new Set()
for (const [a, list] of Object.entries(KIN)) {
  for (const b of list) { KIN_SET.add(a + '|' + b); KIN_SET.add(b + '|' + a) }
}

export function kindred(a, b) { return KIN_SET.has(a + '|' + b) }

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

const DEFAULT_MIX = {}

export function emptyState() {
  return { mix: { ...DEFAULT_MIX }, grudge: 0, at: Date.now() }
}

/** 强度 → 0..1 的饱和：越强涨得越慢，不会一次顶到 1 */
const saturate = (x) => 1 - Math.exp(-Math.max(0, x))

/**
 * 往 mix 里加一种情绪。
 *
 * @param state  { mix, grudge, at }
 * @param key    情绪 key
 * @param inten  强度 0..1（这一下有多重）
 * @param opts   { now, gain }
 */
export function feel(state, key, inten, opts = {}) {
  const now = opts.now || Date.now()
  const gain = Number.isFinite(opts.gain) ? opts.gain : 0.9
  const e = EMOTIONS[key]
  if (!e) return state

  const s = state || emptyState()
  if (!s.mix) s.mix = {}
  const cur = Number(s.mix[key]) || 0
  const v = Math.max(0, Math.min(1, Number(inten) || 0))

  // 首击落标称，复击叠加（越叠越慢）
  const next = cur + (1 - cur) * v * gain
  s.mix[key] = Math.max(0, Math.min(1, next))

  // 相克：这个强了，对面就弱
  for (const other of Object.keys(s.mix)) {
    if (other === key) continue
    if (clashes(key, other)) {
      const w = s.mix[other]
      // 它 0.9 太狠（一次清场），这里 0.35，差得越多才吃得越狠
      const eat = Math.min(0.9, w * (0.15 + 0.55 * s.mix[key]))
      s.mix[other] = Math.max(0, w - eat)
      if (s.mix[other] < 0.02) delete s.mix[other]
    } else if (kindred(key, other)) {
      // 相近：互相喂一点
      s.mix[other] = Math.max(0, Math.min(1, s.mix[other] + 0.12 * s.mix[key]))
    }
  }

  // 怨气：连续被同类负性事件砸，攒起来
  if (e.p[0] < -0.2 && v >= 0.5) {
    s.grudge = Math.max(0, Math.min(1, (Number(s.grudge) || 0) + 0.06 * v))
  } else if (e.p[0] > 0.2 && v >= 0.5) {
    s.grudge = Math.max(0, (Number(s.grudge) || 0) - 0.09 * v)
  }

  s.at = now
  return s
}

/** 时间让每种种情绪各自退 */
export function decayMix(state, now = Date.now()) {
  const s = state || emptyState()
  if (!s.mix) return s
  const dtMin = Math.max(0, (now - (Number(s.at) || now)) / 60000)
  if (dtMin < 0.5) return s
  for (const key of Object.keys(s.mix)) {
    const e = EMOTIONS[key]
    if (!e) { delete s.mix[key]; continue }
    if (e.half >= 9999) continue                  // 真·永不消退（当前没有）
    const k = Math.pow(0.5, dtMin / e.half)
    s.mix[key] *= k
    if (s.mix[key] < 0.02) delete s.mix[key]
  }
  // 怨气半衰 180 分钟
  s.grudge = Math.max(0, (Number(s.grudge) || 0) * Math.pow(0.5, dtMin / 180))
  s.at = now
  return s
}

/** 主调：mix 里最强的那条 */
export function dominant(state) {
  const s = state || emptyState()
  const mix = s.mix || {}
  let best = null, bestV = 0
  for (const [k, v] of Object.entries(mix)) {
    if (v > bestV) { best = k; bestV = v }
  }
  if (!best) return { key: 'calm', label: '平静', strength: 0 }
  const e = EMOTIONS[best] || { label: best, p: [0, 0, 0] }
  return { key: best, label: e.label, strength: bestV, p: e.p }
}

/** 合成 PAD：按强度加权平均 */
export function padOf(state) {
  const s = state || emptyState()
  const mix = s.mix || {}
  let w = 0, v = 0, a = 0, d = 0
  for (const [k, inten] of Object.entries(mix)) {
    const e = EMOTIONS[k]
    if (!e) continue
    w += inten
    v += e.p[0] * inten
    a += e.p[1] * inten
    d += e.p[2] * inten
  }
  if (w <= 0) return { v: 0.1, a: 0.2, d: 0.1, intensity: 0 }
  return { v: v / w, a: a / w, d: d / w, intensity: Math.min(1, w) }
}

/** PAD 八分区（Mehrabian 那八个名字，翻成人话） */
export function octantOf(pad) {
  const s = (x) => (x >= 0 ? '+' : '-')
  const map = {
    '+++': '兴奋', '++-': '依赖', '+-+': '放松', '+--': '温顺',
    '-++': '敌意', '-+-': '焦虑', '--+': '轻蔑', '---': '低落',
  }
  return map[s(pad.v) + s(pad.a) + s(pad.d)] || '平常'
}

// ---------------------------------------------------------------------------
// 强度三档
// 光有 0..1 的数是没用的，界面上得说人话。
// 「有点生气 / 挺生气 / 气炸了」——同一份数据，三种说法。
// ---------------------------------------------------------------------------

const TIER = [
  { up: 0.33, word: '有点', glue: '' },
  { up: 0.66, word: '挺', glue: '' },
  { up: 1.01, word: '', glue: '' },
]

/** 0..1 → 1/2/3 档 */
export function tierOf(x) {
  const v = Math.max(0, Math.min(1, Number(x) || 0))
  if (v < 0.33) return 1
  if (v < 0.66) return 2
  return 3
}

/** 带强度的话：「有点生气」「挺生气」「气炸了」 */
export function say(key, strength) {
  const e = EMOTIONS[key]
  if (!e) return ''
  const n = tierOf(strength)
  // 第三档不是简单加「很」，得换个说法
  const STRONG = {
    angry: '气炸了', joy: '高兴坏了', sad: '难受到不行', scared: '怕得要死',
    tired: '累瘫了', moved: '感动得不行', hurt: '委屈死了', anxious: '慌得不行',
    hollow: '空得发慌', stuffed: '堵得喘不上气', stung: '扎心得厉害',
  }
  if (n === 3 && STRONG[key]) return STRONG[key]
  if (n === 1) return '有点' + e.label
  if (n === 2) return '挺' + e.label
  return e.label
}

// ---------------------------------------------------------------------------
// 组合
// 人很少只有一种情绪。两种同时在，才是真的那个状态。
// 31 个标签组合出 2^31 种，但常用的就这几十对。
// ---------------------------------------------------------------------------

const PAIRS = {
  'angry|fond': '又气又舍不得',
  'fond|angry': '又气又舍不得',
  'angry|hurt': '又气又委屈',
  'hurt|angry': '又气又委屈',
  'scared|fond': '又怕又舍不得',
  'fond|scared': '又怕又舍不得',
  'scared|hurt': '又怕又难受',
  'hurt|scared': '又怕又难受',
  'joy|hurt': '笑着的心疼',
  'hurt|joy': '笑着的心疼',
  'joy|sad': '笑不出来又笑了',
  'sad|joy': '笑不出来又笑了',
  'anxious|eager': '又急又期待',
  'eager|anxious': '又急又期待',
  'proud|guilty': '得意又心虚',
  'guilty|proud': '得意又心虚',
  'tired|fond': '累但舍不得',
  'fond|tired': '累但舍不得',
  'sour|fond': '又酸又舍不得',
  'fond|sour': '又酸又舍不得',
  'lonely|fond': '想要人陪又不肯说',
  'fond|lonely': '想要人陪又不肯说',
  'angry|scared': '又火又怕',
  'scared|angry': '又火又怕',
  'stuffed|angry': '憋着火',
  'angry|stuffed': '憋着火',
  'sad|concede': '认了但难受',
  'concede|sad': '认了但难受',
  'moved|sad': '感动到酸',
  'sad|moved': '感动到酸',
  'heady|scared': '上头又犯怵',
  'scared|heady': '上头又犯怵',
  'calm|tired': '累但踏实',
  'tired|calm': '累但踏实',
  'hollow|fond': '空着又想着',
  'fond|hollow': '空着又想着',
  'defy|hurt': '不服又委屈',
  'hurt|defy': '不服又委屈',
  'bittersweet|fond': '又甜又苦',
}

/**
 * 找组合。两个都在 0.35 以上才算「同时」。
 * 返回 { a, b, label, strength } 或 null
 */
export function pairOf(state) {
  const s = state || emptyState()
  const mix = s.mix || {}
  const arr = Object.entries(mix)
    .filter(([, v]) => v >= 0.35)
    .sort((x, y) => y[1] - x[1])
  if (arr.length < 2) return null
  const [ka, va] = arr[0]
  const [kb, vb] = arr[1]
  const label = PAIRS[ka + '|' + kb] || PAIRS[kb + '|' + ka]
  if (!label) return null
  return { a: ka, b: kb, label, strength: Math.min(va, vb) }
}

/** 一句人话：情绪现在是什么样 */
export function describe(state) {
  const s = state || emptyState()
  const mix = s.mix || {}
  const arr = Object.entries(mix).sort((x, y) => y[1] - x[1])
  if (!arr.length) return '平静'

  const pair = pairOf(s)
  if (pair) return pair.label

  const [k, v] = arr[0]
  return say(k, v)
}

// ---------------------------------------------------------------------------
// 兜底评价：便宜的规则层
// 模型在的时候不该用它，但模型不在的时候不能没有。
// ---------------------------------------------------------------------------

const LEX = {
  fierce:   ['护着', '不许你', '谁动', '我来'],
  angry:    ['他妈', '你妈', '妈的', '草泥马', '尼玛', '卧槽', '我靠', '靠北',
             '傻逼', '傻屌', '傻福', 'cnm', 'tmd', 'nm', '滚蛋', '闭嘴',
             '烦死', '别逼', '有病', '搞什么', '什么玩意', '玩崩', '又崩'],
  disdain:  ['幼稚', '可笑', '装什么', '就这'],
  jealous:  ['凭什么', '他算', '又找'],
  hurt:     ['算了', '随便你', '我不配', '当我没说', '没事'],
  sad:      ['没意思', '不想了', '心累', '难受'],
  lonely:   ['你不在', '一个人', '好久没'],
  dejected: ['撑不住', '没劲', '算了'],
  guilty:   ['对不起', '我错了', '怪我'],
  ashamed:  ['丢人', '我怎么这样', '真要命'],
  numb:     ['哦', '嗯', '随便'],
  tired:    ['好累', '累死', '太累', '很累', '累了', '有点累', '累得', '撑不住', '困了', '想睡'],
  anxious:  ['焦虑', '着急', '心慌', '慌', '压力', '担心', '不安', '怎么办', '来不及', '万一', '要是'],
  nervous:  ['紧张', '不敢', '心里没底'],
  scared:   ['害怕', '好怕', '我怕', '别走', '万一没有'],
  impatient:['快点', '还没', '到底'],
  joy:      ['哈哈哈哈', '太好了', '牛逼', '卧槽真行'],
  happy:    ['不错', '挺好', '还行'],
  moved:    ['谢谢你', '我记住', '没想到'],
  eager:    ['赶紧', '马上', '我这就'],
  curious:  ['为什么', '怎么会', '什么意思'],
  proud:    ['我就说', '看吧', '我厉害'],
  shy:      ['别夸', '哪有', '…'],
  soft:     ['没事', '慢慢来', '不着急'],
  calm:     ['还行吧', '挺好的', '不错'],
  fond:     ['在', '我陪着', '别怕'],
  tense:    ['心里不踏实', '不敢说', '忍着'],

  // 中文特有那批的触发词
  sour:     ['酸了', '凭什么他', '就他有'],
  queasy:   ['膈应', '恶心到', '脏'],
  jittery:  ['心虚', '没底气', '怕被发现'],
  heady:    ['上头', '冲了', '不管了'],
  stuffed:  ['堵得慌', '堵着', '说不出来'],
  tastebad: ['不是滋味', '怪怪的', '别扭'],
  hollow:   ['发空', '心里空', '没着没落'],
  pumped:   ['来劲', '有劲了', '干就完了'],
  pent:     ['憋着', '忍着', '没发出来'],
  light:    ['松快', '轻松了', '舒坦'],
  concede:  ['服了', '认了', '行吧你赢'],
  defy:     ['不服', '凭什么', '我就不'],
  lucky:    ['还好', '差点', '幸好'],
  sore:     ['心疼', '心里一抽'],
  dread:    ['犯怵', '怵', '不敢想'],
  awkward:  ['抹不开', '尴尬', '不好意思'],
  bittersweet:['又甜又苦', '舍不得又', '又想又怕'],
  resigned: ['算了', '随它吧', '由它去'],
  stung:    ['扎心', '心里一疼', '戳到'],
}

/** 从一句话估出 11 维。兜底用，模型在的时候更好。 */
export function cheapAppraise(text) {
  const s = String(text || '')
  const bare = s.trim()
  /* 单字关键词只在「整句就是它」时算数。
   * 为什么：fond 里有「在」，结果「那现在是真的了吗」被判成亲近；
   * angry 里有「操」，「操作」「操练」全中枪；「滚」撞「滚动」。
   * 一个字的词放在中文里几乎没有不撞的。 */
  const hit = (list) => list.reduce((n, w) => {
    if (w.length === 1) return n + (bare === w ? 1 : 0)
    return n + (s.includes(w) ? 1 : 0)
  }, 0)

  let best = null, bestN = 0
  for (const [k, words] of Object.entries(LEX)) {
    const n = hit(words)
    if (n > bestN) { best = k; bestN = n }
  }
  // 一个词都没命中 = 没有情绪。不要给 calm 一个 0.25 的强度 ——
  // 那等于把「平静」当成一种情绪记下来，mix 会莫名其妙一直有个 calm 挂着。
  if (!best) return { key: 'calm', intensity: 0, dims: {} }

  const e = EMOTIONS[best]
  // 有标点、有感叹号、有脏话加成
  // 脏话本身就该加一档：骂人的时候，不是「有点」的情绪
  const swearing = /他妈的|你妈|妈的|操|草|cnm|tmd|傻逼|滚|别逼/.test(s)
  const punch = (s.match(/[！!]/g) || []).length * 0.15
    + (s.match(/[？?]/g) || []).length * 0.1
    + (s.length > 40 ? 0.1 : 0)
    + (swearing ? 0.18 : 0)
  // 0.18 太猛：「算了，随便你」一句话就顶到 0.76 = 委屈死了。
  // 降到 0.11，一句话大概落在 0.45–0.6（「挺委屈」），要连续叠加才到第三档。
  const intensity = Math.max(0.2, Math.min(1, 0.34 + bestN * 0.11 + punch))

  return {
    key: best,
    intensity,
    dims: {
      relevance: 0.5,
      conduciveness: e.p[0],
      urgency: Math.max(0, e.p[1]),
      agency: /你/.test(s) ? 'other' : 'self',
    },
  }
}

// ---------------------------------------------------------------------------
// 标定表
// 这些常数不是拍的，是按「一个正常人一天里情绪怎么起落」定的。
// 以后有真数据了，改这里就行，不用翻代码。
// ---------------------------------------------------------------------------
export const CALIBRATION = {
  clashEatMin: 0.15,      // 相克最小吃掉的量
  clashEatMax: 0.55,      // 相克最大吃掉的量（它原版 0.9，一次清场，太狠）
  kinFeed: 0.12,          // 相近互喂
  grudgeUp: 0.06,         // 负性事件攒怨气
  grudgeDown: 0.09,       // 正性事件消怨气
  grudgeHalf: 180,        // 怨气半衰（分钟）
  deadLine: 0.02,         // 低于这个就当没了
}
