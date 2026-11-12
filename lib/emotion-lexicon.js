/**
 * 情绪词库：八维坐标 / 五十一个名字
 * ================================
 *
 * 决定一：**不合并。** 已有的 51 种情绪是「名字」，八维是「坐标」，
 * 同一个东西的两种表示。合并会丢东西，两套并存又会打架——所以做成
 * 「八维是主向量，51 个词是它最近的那个名字」。
 *
 * 决定二：**归属用语义表，不用纯距离。**
 * 第一版按 PAD 距离自动归类，结果「焦虑、紧张、犯怵」被归进「心疼」，
 * 「委屈、难过、孤独」被归进「乏」——距离能算"感觉像不像"，
 * 算不出"意思对不对"。所以手写归属表，距离只做未登录词的兜底。
 *
 * 决定三：**八维只装「一个人待着时会有的」情绪。**
 * 被骂、被吓、被撩那种高唤醒，仍然由原来的情绪负责，不进八维底色。
 * 它们有归属（能投影），但标成 loud。
 */
import { EMOTIONS } from '../assets/emotion.js'

/**
 * 八维。每个维度有自己的 PAD 原型（v 效价 -1..1，a 唤醒 0..1，d 掌控 -1..1）。
 *
 * 挑这八个的理由：它们都是「一个人待着的时候会有的」。
 * 「温柔」被换掉了——那是待人的姿态，不是情绪，混进来会把整套推断歪掉。
 */
export const DIMS = {
  calm:         { label: '安宁', pad: [ 0.35, 0.10,  0.20], note: '平和松弛，没有躁动' },
  lonely:       { label: '闷得慌', pad: [-0.25, 0.08, -0.20], note: '淡淡的空旷，不一定痛苦' },
  wistful:      { label: '失落', pad: [-0.18, 0.10, -0.10], note: '事情落幕后的空落' },
  flutter:      { label: '心动', pad: [ 0.30, 0.38,  0.10], note: '心动，忐忑又雀跃' },
  unreconciled: { label: '不甘', pad: [-0.35, 0.30,  0.35], note: '付出了，结果不如预期' },
  weary:        { label: '乏', pad: [-0.30, 0.05, -0.15], note: '心绪疲惫，提不起兴致' },
  dazed:        { label: '发空', pad: [-0.05, 0.10, -0.25], note: '记得往事，却抓不住当时的感受' },
  tender:       { label: '心疼', pad: [-0.15, 0.25, -0.10], note: '一闪而过的心疼' },
}

/** 八维的键，顺序固定（展示和存储都按这个顺序） */
export const DIM_KEYS = Object.keys(DIMS)

/**
 * 归属表。quiet = 独处时会有，算内心底色；loud = 被外界激出来的高唤醒。
 */
const ASSIGN = {
  calm: [['calm', 'quiet'], ['light', 'quiet'], ['concede', 'quiet']],
  lonely: [['lonely', 'quiet'], ['hollow', 'quiet'], ['sad', 'quiet'], ['stuffed', 'loud']],
  wistful: [['resigned', 'quiet'], ['bittersweet', 'quiet'], ['tastebad', 'quiet'], ['sour', 'quiet']],
  flutter: [['joy', 'quiet'], ['happy', 'quiet'], ['moved', 'quiet'], ['eager', 'quiet'],
    ['curious', 'quiet'], ['proud', 'quiet'], ['shy', 'quiet'], ['heady', 'quiet'],
    ['pumped', 'quiet'], ['lucky', 'quiet']],
  // 不甘：底色只有「憋着」——现有的词里就它一个是独处时的不服
  unreconciled: [['pent', 'quiet'], ['defy', 'loud'], ['fierce', 'loud'], ['angry', 'loud'],
    ['disdain', 'loud'], ['disgusted', 'loud'], ['jealous', 'loud'], ['impatient', 'loud']],
  weary: [['drained', 'quiet'], ['tired', 'quiet'], ['bored', 'quiet'], ['numb', 'quiet'],
    ['dejected', 'quiet'], ['queasy', 'quiet']],
  // 发空：抓不住、发虚、没落点。恐惧那一族也放这儿——都是「不定」
  dazed: [['jittery', 'quiet'], ['awkward', 'quiet'],
    ['scared', 'loud'], ['dread', 'loud'], ['nervous', 'loud'], ['anxious', 'loud'],
    ['restless', 'loud'], ['tense', 'loud']],
  // 心疼：为别人（或自己）软一下、疼一下
  tender: [['stung', 'quiet'], ['soft', 'quiet'], ['fond', 'quiet'],
    ['sore', 'loud'], ['hurt', 'loud'], ['guilty', 'loud'], ['ashamed', 'loud'],
    ['worried', 'loud']],
}

export const KEY_TO_DIM = {}
export const KEY_KIND = {}

for (const [dim, rows] of Object.entries(ASSIGN)) {
  for (const [k, kind] of rows) {
    if (!EMOTIONS[k]) continue          // 词表里没有就跳过，别造不存在的词
    KEY_TO_DIM[k] = dim
    KEY_KIND[k] = kind
  }
}

/** PAD 距离：d 轴权重低一点，它偏「掌控」不像情绪 */
function padDist(a, b) {
  const dv = (a[0] || 0) - (b[0] || 0)
  const da = (a[1] || 0) - (b[1] || 0)
  const dd = ((a[2] || 0) - (b[2] || 0)) * 0.5
  return Math.sqrt(dv * dv + da * da + dd * dd) || 1e-6
}

/** 疏漏兜底：还没归属的词按距离找最近的维度，保证一个都不落下 */
export const KEY_FALLBACK = []
for (const [k, v] of Object.entries(EMOTIONS)) {
  if (KEY_TO_DIM[k]) continue
  let best = null
  let bestD = Infinity
  for (const dk of DIM_KEYS) {
    const d = padDist(v.p || [0, 0, 0], DIMS[dk].pad)
    if (d < bestD) { bestD = d; best = dk }
  }
  KEY_TO_DIM[k] = best
  KEY_KIND[k] = 'loud'
  KEY_FALLBACK.push(k)          // 记下来：这些是靠兜底的，人工得复核
}

/** 某个维度下面挂了哪些底色词（给展示用） */
export const DIM_TO_KEYS = {}
for (const dk of DIM_KEYS) DIM_TO_KEYS[dk] = []
for (const [k, dk] of Object.entries(KEY_TO_DIM)) {
  if (KEY_KIND[k] === 'quiet') DIM_TO_KEYS[dk].push(k)
}

/**
 * PAD → 八维强度。
 *
 * 不是"分类"，是"投影"：离哪个原型近，哪个就强。八个数加起来约等于 1，
 * 而且**可以同时有好几个高的**——人本来就能一边安宁一边失落。
 */
export function project(pad, temperature = 0.22) {
  const src = [Number(pad && pad.v) || 0, Number(pad && pad.a) || 0, Number(pad && pad.d) || 0]
  const raw = {}
  let sum = 0
  for (const dk of DIM_KEYS) {
    const d = padDist(src, DIMS[dk].pad)
    const w = Math.exp(-d / temperature)
    raw[dk] = w
    sum += w
  }
  const out = {}
  for (const dk of DIM_KEYS) out[dk] = sum ? Number((raw[dk] / sum).toFixed(4)) : 0
  return out
}

/** 八维里最强的那一个 */
export function dominantDim(dims) {
  let best = null
  let bestV = -1
  for (const dk of DIM_KEYS) {
    const v = Number(dims && dims[dk]) || 0
    if (v > bestV) { bestV = v; best = dk }
  }
  return best
}

/** 八维 → 一句人话：「挺闷得慌，底下压着失落、乏」 */
export function describeDims(dims, floor = 0.12) {
  const list = DIM_KEYS
    .map((dk) => ({ dk, v: Number(dims && dims[dk]) || 0 }))
    .filter((x) => x.v >= floor)
    .sort((a, b) => b.v - a.v)
  if (!list.length) return '平'
  const head = DIMS[list[0].dk].label
  const rest = list.slice(1, 3).map((x) => DIMS[x.dk].label)
  if (!rest.length) return head
  return '挺' + head + '，底下压着' + rest.join('、')
}

/** 把一个情绪词直接转成八维（给旧数据用） */
export function projectKey(emoKey) {
  const e = EMOTIONS[emoKey]
  if (!e) return project([0, 0, 0])
  return project(e.p)
}
