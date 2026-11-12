/**
 * 中文切词与停用词
 * ==================
 *
 * 检索的第一层。把一句话切成「能被匹配的碎片」。
 *
 * 三件事：
 *   1. 二字 / 三字组合（bigram / trigram）
 *   2. 真分词（用 11 万词词典做最大匹配）
 *   3. 停用词过滤（「什么」「怎么」这种自己没信息的词）
 *
 * 为什么停用词这么重要：中文的噪音词大多是两个字。
 * 「他抽什么烟」切成 他抽 / 抽什 / 什么 / 么烟 —— 「什么」白送一分，
 * 于是任何带「什么」的记忆都算命中，真正该排第一的反而被挤到第八。
 */
import { readFileSync } from 'node:fs'
import { DICT_PATH } from './paths.js'

/** 单个字的停用字：两边都是它们就跳过这个二元组 */
export const STOP_CHARS = new Set('的了是在有和就不都一也人与这那之着过吗呢吧啊哦嗯')

/**
 * 两字停用词。
 * 只放「自己没意义、只靠上下文活着」的词。
 * 不放「吵架」「睡觉」这种——它们本身就有信息。
 */
export const STOP_WORDS = new Set([
  '什么', '怎么', '为什', '么样', '这个', '那个', '这些', '那些',
  '一下', '一个', '就是', '还是', '但是', '因为', '所以', '如果',
  '可以', '不能', '没有', '不是', '已经', '现在', '时候', '这样',
  '那样', '多少', '哪个', '哪些', '如何', '是否', '或者', '而且',
  '然后', '其实', '真的', '不过', '只是', '还是', '也是', '都是',
  '知道', '觉得', '认为', '应该', '需要', '可能', '一定', '有点',
  '一点', '一些', '这种', '那种', '我们', '你们', '他们', '自己',
  '东西', '事情', '问题', '地方', '时间', '哪里', '这里', '那里',
])

/* 真分词：用一份 11 万词的中文词典做最大匹配。
 * 原来只有二字组合，「车站」会被拆成「车」和「站」，「吵架」反而拼不出来。
 * 词典来自 dsh-fish-memory（MIT），放在 assets 下。 */
let _DICT = null
let _MAXLEN = 1

export function loadDict() {
  if (_DICT) return _DICT
  try {
    const raw = readFileSync(DICT_PATH, 'utf8')
    _DICT = new Set()
    for (const line of raw.split('\n')) {
      const w = line.trim()
      if (!w) continue
      _DICT.add(w)
      if (w.length > _MAXLEN) _MAXLEN = w.length
    }
  } catch {
    _DICT = new Set()
  }
  return _DICT
}

/** 最大匹配分词。返回词数组 */
export function segmentWords(text) {
  const dict = loadDict()
  const out = []
  let i = 0
  while (i < text.length) {
    let matched = null
    const maxL = Math.min(_MAXLEN, text.length - i)
    for (let len = maxL; len >= 2; len--) {
      const w = text.slice(i, i + len)
      if (dict.has(w)) { matched = w; break }
    }
    if (matched) { out.push(matched); i += matched.length }
    else { out.push(text[i]); i += 1 }
  }
  return out
}

/**
 * 把一段文字切成 gram 集合。
 * opts.single === false 时不加单字（长查询加单字会污染）。
 * opts.bigOnly === true 时只出二字。
 */
export function gramsOf(s, opts) {
  const set = new Set()
  const only = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const bigOnly = !!(opts && opts.bigOnly)
  // 二字：两边都是停用字就跳过
  for (let i = 0; i < only.length - 1; i++) {
    const a = only[i], b = only[i + 1]
    if (STOP_CHARS.has(a) && STOP_CHARS.has(b)) continue
    const bg = only.slice(i, i + 2).toLowerCase()
    // 两字停用词跳过：「什么」「怎么」「一下」这种自己没信息
    if (STOP_WORDS.has(bg)) continue
    // 统一小写：GMod 和 gmod 必须落进同一个桶
    set.add(bg)
  }
  // 英文/数字整词：GMod、DSH、5060Ti 这种，按整词进索引
  // 之前只切中文，英文词根本进不了任何一个 gram，查 GMod 命中 0 条
  try {
    const em = only.match(/[A-Za-z][A-Za-z0-9_-]*|[0-9][A-Za-z0-9_-]*/g)
    if (em) for (const w of em) if (w.length >= 2) set.add(w.toLowerCase())
  } catch {}

  if (!bigOnly) {
    // 三字：更具体，命中时权重更高
    for (let i = 0; i < only.length - 2; i++) {
      const tg = only.slice(i, i + 3).toLowerCase()
      // 三字的前两字或后两字是停用词，就跳过
      if (STOP_WORDS.has(tg.slice(0, 2)) || STOP_WORDS.has(tg.slice(1, 3))) continue
      set.add(tg)
    }
    // 真分词：词表里有的词，整词进去
    for (const w of segmentWords(only)) {
      if (STOP_WORDS.has(w)) continue
      if (w.length >= 2 && !STOP_CHARS.has(w)) set.add(w)
    }
  }
  // 单字：文档侧总有；查询侧只在很短的时候加（「钱」「走」「死」）。
  // 长查询加单字会污染——问「车站」会被「车」和「站」带偏。
  const useSingle = !opts || opts.single !== false
  if (useSingle) {
    for (const ch of only) {
      // 只收中文单字。英文单字母是噪音——GMod 会切出 G/M/o/d 四个垃圾 gram
      if (!/[\u4e00-\u9fa5]/.test(ch)) continue
      if (STOP_CHARS.has(ch)) continue
      set.add(ch)
    }
  }
  return set
}

/** 同义扩展：问到这些词，也去找它们常出现的那几个字。
 * 例：问「吵架」，也要能翻到「骂」「凶」「气」。 */
export const SYNONYMS = [
  ['吵架', '骂 凶 气 吵 闹'],
  ['难过', '哭 难受 委屈 崩'],
  ['高兴', '笑 开心 爽 乐'],
  ['累', '疲惫 撑不住 困 倦'],
  ['离开', '走 消失 不在 走人'],
  ['想念', '想 惦记 记得'],
  ['道歉', '对不起 抱歉 认错'],
  // 身份与身体：这几类问法最常撞不上词
  ['真名', '本名 名字 大名 叫'],
  ['名字', '本名 真名'],
  ['减肥', '瘦 体重 斤 减'],
  ['体重', '斤 减肥 瘦 多重'],
  ['多重', '体重 斤 减肥'],
  ['抽烟', '烟 徽商 软蓝'],
  ['喝酒', '酒 白酒 啤酒'],
]

export function expandQuery(q) {
  const extra = []
  for (const [k, vs] of SYNONYMS) {
    if (q.includes(k) || q.includes(k.slice(0, 2))) {
      for (const v of vs.split(' ')) if (v) extra.push(v)
    }
  }
  return extra
}
