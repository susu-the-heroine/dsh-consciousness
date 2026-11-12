/**
 * 她的声音：只提示，不改写
 * ====================
 * 基准来自她自己写自己的话（herSide 的 felt / wanted / did / regret），
 * 不是苏苏侠，也不是"一般人"。
 *
 * 三条硬规矩（苏苏侠定的）：
 *   1. 她只是她，人和人不一样，没有一样的人。
 *   2. 所以这把尺子只回答"这句像不像她平时说话"，**不能判对错**。
 *   3. 人会变。她的画像要带时间，允许漂移；不像了，先看是不是她在长。
 *
 * 用法：
 *   import { herVoice } from './hervoice.js'
 *   herVoice('我又不是来交作业的')
 *   → { score, verdict, why }
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-hervoice.json')

const clamp = (x) => Math.max(0, Math.min(1, x))

/** 特征：都 0~1，别让某个维度一家独大 */
export function feats(t) {
  const s = String(t || '').trim()
  return {
    第一人称: /我/.test(s) ? 1 : 0,
    第二人称: /你|他|她/.test(s) ? 1 : 0,
    否定: /不|没|别|甭/.test(s) ? 1 : 0,
    骂人: /他妈|他吗|傻|草|靠|卧槽|操|妈的|狗/.test(s) ? 1 : 0,
    语气词: /[啊吧呢嘛呗么呀哦喔咯啦嘞呐嗯诶哎嘿哈]/.test(s) ? 1 : 0,
    比喻: /像|似的|一样|等于|好比/.test(s) ? 1 : 0,
    感叹: /[！!]/.test(s) ? 1 : 0,
    问号: /[？?]/.test(s) ? 1 : 0,
    省略: /…|\.\.\./.test(s) ? 1 : 0,
    定义腔: /是.{2,12}的.{0,6}不是|所谓|本质上|意味着|也就是说/.test(s) ? 1 : 0,
    列举腔: /首先|其次|第三|最后一点|总的来说|综上/.test(s) ? 1 : 0,
  }
}

export function herPath() {
  return FILE
}

export function readProfile() {
  try {
    if (!existsSync(FILE)) return null
    const j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!j || !j.centroid) return null
    return j
  } catch { return null }
}

/** 余弦；两边都没特征时返回 null，不硬给分 */
export function similarity(text, profile) {
  const p = profile || readProfile()
  if (!p) return null
  const v = feats(text)
  const keys = Object.keys(p.centroid)
  let dot = 0
  let na = 0
  let nb = 0
  for (const k of keys) {
    const a = Number(v[k]) || 0
    const b = Number(p.centroid[k]) || 0
    dot += a * b
    na += a * a
    nb += b * b
  }
  if (!na || !nb) return null
  return clamp(dot / Math.sqrt(na * nb))
}

/**
 * 主函数：像不像她。
 * verdict 只有三个词，**没有"错"这个选项**——不像只是不像，不代表写坏了。
 */
export function herVoice(text, profile) {
  const p = profile || readProfile()
  const s = similarity(text, p)
  if (s == null) return { score: null, verdict: '不知道', why: '还没有她的画像，先跑 scripts/her-voice.mjs' }

  const v = feats(text)
  const why = []
  if (v.定义腔) why.push('有定义腔（"是……不是……"那种）')
  if (v.列举腔) why.push('有列举腔（首先/其次/总之）')
  if (!v.第一人称) why.push('没说"我"')
  const len = [...String(text || '').trim()].length
  if (p.len && p.len.p90 && len > p.len.p90) why.push('比她平时一句长')

  let verdict
  if (s >= 0.85) verdict = '像她自己'
  else if (s >= 0.7) verdict = '还行'
  else verdict = '不太像她平时'

  return { score: Number(s.toFixed(3)), verdict, why: why.join('；') || '没挑出毛病' }
}

/** 画像随她长：把新句子并进去，慢慢挪，不推倒重来 */
export function learn(text, weight = 0.02, profile) {
  const p = profile || readProfile()
  if (!p) return { ok: false, reason: '没有画像' }
  const v = feats(text)
  const keys = Object.keys(p.centroid)
  for (const k of keys) {
    const old = Number(p.centroid[k]) || 0
    p.centroid[k] = Number((old * (1 - weight) + (Number(v[k]) || 0) * weight).toFixed(4))
  }
  p.n = (p.n || 0) + 1
  p.updatedAt = Date.now()
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(p, null, 1), 'utf8')
    return { ok: true, n: p.n }
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) }
  }
}
