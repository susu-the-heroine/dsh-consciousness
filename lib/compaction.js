/**
 * 压缩感知 + 规矩在场断言（2026-11-16，清单第 12 件）
 * ------------------------------------------------------------
 * 宿主有四个现成钩子（agent/pre-step、request-error、compaction/*、
 * summary-error），咱们一个都没接过。这里不碰 pre-step——
 * 那是 waterflow 型事件，监听器返回 undefined 会打断宿主下一步
 * （2026-11-14 已踩过，撤掉了）。只接后三个，全 fire-and-forget，
 * 只写审计、不动流程。
 *
 * 断言：每轮注入出来的文本必须含【规矩·不许忘】，且条数不少于上次；
 * 少了就大声记审计，由调用方把规矩整块重拼回去。
 */
import { audit } from './log.js'

const state = { lastRuleCount: 0 }

/** 数【规矩·不许忘】下面的条目数（每行一条「· 」开头）。 */
export function countRules (text) {
  const i = String(text || '').indexOf('【规矩·不许忘】')
  if (i < 0) return 0
  const seg = String(text).slice(i, i + 1600)
  return (seg.match(/\n\s*·\s/g) || []).length
}

/** 这轮有规矩栏就记下条数，作为下次的底线。 */
export function noteRules (text) {
  const n = countRules(text)
  if (n > 0) state.lastRuleCount = n
  return n
}

/**
 * 断言规矩在场：没了 / 比上次少，都返回 { ok:false } 并记审计。
 * 规矩栏本来没有（新库、用户没立规矩）不算坏——count 是 0 且上次也是 0。
 */
export function assertRules (text, where) {
  const now = countRules(text)
  const last = state.lastRuleCount
  const tag = where || 'inject'
  if (now === 0 && last > 0) {
    try { audit('rules-assert-missing', { where: tag, was: last }) } catch {}
    return { ok: false, why: 'missing', was: last, now }
  }
  if (last > 0 && now < last) {
    try { audit('rules-assert-shrunk', { where: tag, was: last, now }) } catch {}
    return { ok: false, why: 'shrunk', was: last, now }
  }
  state.lastRuleCount = now
  return { ok: true, now }
}

/** 压缩发生了：清掉调用方缓存的入口记一笔。真正的清缓存由 inject 自己干。 */
export function noteCompaction (sid) {
  try { audit('compaction-seen', { sid: String(sid || '').slice(0, 24), at: Date.now() }) } catch {}
}

/** summary-error / request-error：只记不拦。 */
export function noteHostError (kind, err) {
  try { audit('host-' + String(kind || 'error'), { err: String((err && err.message) || err || '').slice(0, 120) }) } catch {}
}
