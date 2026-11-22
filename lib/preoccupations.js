/**
 * 心事
 * ====
 *
 * 人心里不会挂一百件事，是两三件反复转。所以最多三件。
 *
 * 重量怎么变：
 *   欠着的（约定）    随天数涨，涨得最快
 *   没答完的问句     随天数涨，慢一点
 *   自己想不通的     随天数涨，最慢
 *   被提起          重量降一大截（说过了就没那么压着了）
 *
 * **一个必须有的出口：注入满 3 次，判「想过了，放下」。**
 * 没有这条，她会一辈子盯着同一件事，那不叫心事，叫钻牛角尖。
 */
import { audit } from './log.js'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME } from './paths.js'

// 2026-11-20：心事原来只活在内存里——每轮重建，注入次数永远从零开始，
// 于是「注入满三次判放下」那条出口从来没生效过，同一件事能被念叨一辈子。
// 落一份小账：重建时接着旧账走，说过几次、放没放下都记得。
const FILE = join(HOME, '.dsh', 'consciousness-preoccupations.json')
let _CACHE = null

function loadExisting() {
  try {
    if (!existsSync(FILE)) return []
    const o = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    const arr = Array.isArray(o && o.items) ? o.items : []
    const cut = Date.now() - 30 * 86400000
    return arr.filter((x) => x && !(x.done && Number(x.lastTouch || x.born || 0) < cut))
  } catch { return [] }
}

function saveItems(list) {
  try {
    const dir = dirname(FILE)
    mkdirSync(dir, { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify({ at: Date.now(), items: list }), 'utf8')
    renameSync(tmp, FILE)
    return true
  } catch { return false }
}

/** 最多同时挂几件 */
export const MAX_ITEMS = 3
/** 注入满这么多次，判"想过了" */
export const SETTLE_AFTER = 3

/** 三类来源的基准重量与增长速度（每天涨多少） */
const KINDS = {
  promise: { label: '欠着的', base: 0.55, grow: 0.030 },
  question: { label: '没答完的', base: 0.40, grow: 0.018 },
  thought: { label: '想不通的', base: 0.30, grow: 0.012 },
}

/**
 * 算一件心事现在多重。
 *
 * @param item {kind, born, lastTouch, injectedCount, weight0}
 * @param now  毫秒
 */
export function weightOf(item, now) {
  if (!item) return 0
  const k = KINDS[item.kind] || KINDS.thought
  const t = Number(now) || Date.now()
  const born = Number(item.born) || t
  const days = Math.max(0, (t - born) / 86400000)
  // 长得慢，且封顶——不能无限涨
  const grew = k.grow * Math.log1p(days)
  const w0 = Number.isFinite(Number(item.weight0)) ? Number(item.weight0) : k.base
  const touched = Math.max(0, Number(item.injectedCount) || 0)
  // 每被说过一次，掉 22%（真的说出口会松一口气）
  const relief = Math.pow(0.78, touched)
  return Number(Math.min(1, (w0 + grew) * relief).toFixed(4))
}

/** 该不该判"想过了" */
export function isSettled(item) {
  return (Number(item && item.injectedCount) || 0) >= SETTLE_AFTER
}

/** 从一堆候选里挑最重的几件（已放下的不算） */
export function topItems(items, n, now) {
  const t = Number(now) || Date.now()
  return (items || [])
    .filter((x) => x && !x.done && !isSettled(x))
    .map((x) => ({ ...x, weight: weightOf(x, t) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.max(0, Number(n) || MAX_ITEMS))
}

/**
 * 从记忆和约定里收心事。
 *
 * 这里是**唯一**能把外部东西变成心事的地方：
 *   未兑现的约定 → promise
 *   上一句是问句且我没答 → question
 *   我自己写的念头（没完结的）→ thought
 *
 * 已有的心事不重复加（按 text 前 30 字判重）。
 */
export function collect({ promises, lastAsked, thoughts, existing }, now) {
  const t = Number(now) || Date.now()
  const out = Array.isArray(existing) ? existing.slice() : loadExisting()
  // 2026-11-20：判重原来把「已放下」的排除掉——于是刚判放下那条，下一刻又被当成新的加回来，
  // 次数清零，永远放不下。判重就按原文，不看放没放下。
  const has = (s) => out.some((x) => String(x.text || '').slice(0, 30) === String(s).slice(0, 30))

  for (const p of promises || []) {
    const text = String(p || '').slice(0, 80)
    if (!text || has(text)) continue
    out.push({ id: 'p' + out.length + '_' + t, kind: 'promise', text, born: t, injectedCount: 0, done: false })
  }
  if (lastAsked) {
    const text = String(lastAsked).slice(0, 80)
    if (text && !has(text)) {
      out.push({ id: 'q' + t, kind: 'question', text, born: t, injectedCount: 0, done: false })
    }
  }
  for (const th of thoughts || []) {
    if (!th || th.archived) continue
    const text = String((th && th.text) || '').slice(0, 80)
    if (!text || has(text)) continue
    out.push({ id: 't' + (th.id || t), kind: 'thought', text, born: Number(th.born) || t, injectedCount: 0, done: false })
  }

  // 只留最重的前三件，其余不进队（不是删，是不占位置）
  const ranked = topItems(out, MAX_ITEMS, t)
  _CACHE = out
  saveItems(out)
  try { audit('preoccupations', { have: out.length, kept: ranked.length }) } catch {}
  return ranked
}

/** 被注入了一次 */
export function markInjected(item) {
  if (!item) return item
  item.injectedCount = (Number(item.injectedCount) || 0) + 1
  item.lastTouch = Date.now()
  if (isSettled(item)) item.done = true
  // 2026-11-20：topItems 回的是浅拷贝——只改传进来这个对象，账本里那份还是旧数，
  // 存下去等于没记。按 id 找回账本里那一条一起改。
  _syncCache(item)
  if (_CACHE) saveItems(_CACHE)
  return item
}

/** 把改过的字段写回账本里同一条 */
function _syncCache(item) {
  if (!_CACHE || !item) return
  const k = String(item.id == null ? item.text : item.id)
  for (const x of _CACHE) {
    if (String(x.id == null ? x.text : x.id) !== k) continue
    x.injectedCount = item.injectedCount
    x.lastTouch = item.lastTouch
    x.done = !!item.done
    if (item.weight0 !== undefined) x.weight0 = item.weight0
    break
  }
}

/** 被提起了（他主动问到了）：直接降重 */
export function markRaised(item) {
  if (!item) return item
  item.injectedCount = (Number(item.injectedCount) || 0) + 2
  item.weight0 = Number((weightOf(item) * 0.5).toFixed(4))
  item.lastTouch = Date.now()
  if (isSettled(item)) item.done = true
  _syncCache(item)
  if (_CACHE) saveItems(_CACHE)
  return item
}

/** 一句话怎么说（不许催、不许播报） */
export function describeItem(item, now) {
  if (!item) return ''
  const k = KINDS[item.kind] || KINDS.thought
  return k.label + '：' + String(item.text || '').slice(0, 60)
}
