/**
 * 回看她的上一句
 * =============
 * DSH 给了 agent/turn-stopping：能读到她刚说的话，但改不了。
 * 所以这里做的是「回看 + 记账」：太像稿子就记一笔，下一轮注入里提醒她重说。
 *
 * 这不是硬约束，是闭环里的软纠正——但至少不用人盯着。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-replycheck.json')
// 每轮判定落一行，只存分数和类别，不存正文
const LOG = join(homedir(), '.dsh', 'consciousness-flavor-log.jsonl')
function appendLog(o) {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, JSON.stringify(o) + '\n', 'utf8')
    trimLog()
  } catch {}
}
// 2026-11-22：日志不能无限长。到 400 KB 就只留最近 400 行。
// 老记录没人看，攒到几万行反而拖慢页面。
function trimLog() {
  try {
    if (statSync(LOG).size < 400 * 1024) return
    const lines = readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
    if (lines.length <= 800) return
    writeFileSync(LOG, lines.slice(-400).join('\n') + '\n', 'utf8')
  } catch {}
}
// 基线：第一次判定的样子，只写一次，之后不覆盖。
// 为什么要有它——换模型、改设置、对话变长之后，只有一个孤零零的分数看不出退没退。
const BASE = join(homedir(), '.dsh', 'consciousness-baseline.json')

function readBaseline() {
  try {
    if (!existsSync(BASE)) return null
    const j = JSON.parse(readFileSync(BASE, 'utf8'))
    return j && typeof j.score === 'number' ? j : null
  } catch { return null }
}

function ensureBaseline(score, kinds) {
  const cur = readBaseline()
  if (cur) return cur
  const o = { at: Date.now(), score, kinds: Array.isArray(kinds) ? kinds : [] }
  try {
    mkdirSync(dirname(BASE), { recursive: true })
    writeJsonAtomic(BASE, o)
  } catch {}
  return o
}

export function baselinePath() { return BASE }
export { readBaseline }

import { aiflavor } from './aiflavor.js'
import { tuning } from './tuning.js'
import { shortVoice } from './shortvoice.js'

function readAll() {
  try {
    if (!existsSync(FILE)) return {}
    return JSON.parse(readFileSync(FILE, 'utf8')) || {}
  } catch { return {} }
}

function writeAll(o) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeJsonAtomic(FILE, o)
  } catch {}
}

/** 她说完一句：量一下，太像稿子就记一笔 */
export function recordReply(sid, text) {
  const t = String(text || '')
  if ([...t].length < 8) return null
  const r = aiflavor(t)
  // 短句另算一把：她那批句子都是十几个字，这一档最容易写得"正确但没味"。
  // 只在她确实说了短句时才算，长段不掺和。
  const n = [...t].length
  let short = null
  if (n >= 4 && n <= 30) {
    try { short = Number(shortVoice(t).score) || 0 } catch { short = null }
  }
  const T2 = tuning()
  const shortBad = Number(T2.shortBadOn) === 1 && short != null && short < (Number(T2.shortBadScore) || 0.18)
  const all = readAll()
  const cur = all[String(sid)] || {}
  // 有腔、或者短句不像她，都算一次；单次可能是引用或代码块，所以连续两次才提醒
  const badScore = Number(tuning().replyBadScore) || 0.35
  const badNow = r.score >= badScore || shortBad
  const streak = badNow ? (Number(cur.streak) || 0) + 1 : 0
  all[String(sid)] = {
    streak,
    last: r.score,
    kinds: shortBad ? [...(r.kinds || []), '短句没味'] : r.kinds,
    short,
    at: Date.now(),
  }
  writeAll(all)
  ensureBaseline(r.score, r.kinds)
  appendLog({ at: Date.now(), sid: String(sid), score: r.score, kinds: r.kinds, short, bad: badNow ? 1 : 0,
      head: String(text || '').replace(/\s+/g, ' ').slice(0, 60) })
  return { score: r.score, kinds: r.kinds, streak }
}

/** 开下一轮之前取一次：要不要提醒，取了就清 */
export function takeWarning(sid) {
  const all = readAll()
  const cur = all[String(sid)]
  if (!cur) return ''
  if ((Number(cur.streak) || 0) < (Number(tuning().retryStreak) || 1)) return ''
  const kinds = Array.isArray(cur.kinds) && cur.kinds.length ? cur.kinds.join('/') : '腔'
  // 清了，别连续唠叨
  delete all[String(sid)]
  writeAll(all)
  return '（上一条你说得像稿子：' + kinds + '。这条重说，别用"首先/总之/这是……不是……"。）'
}

export function replyCheckPath() {
  return FILE
}

/**
 * 该不该让她重说。
 * 规矩是我们自己定的：连着两次有腔，且距上次重说超过五分钟。
 * 五分钟是防她无限自说自话——一条回复不够好就重来一次，够了。
 */
export function shouldRetry(sid) {
  const all = readAll()
  const cur = all[String(sid)] || {}
  if ((Number(cur.streak) || 0) < (Number(tuning().retryStreak) || 1)) return false
  const last = Number(cur.retryAt) || 0
  if (Date.now() - last < 5 * 60 * 1000) return false
  return true
}

/** 记一次重说：打时间戳，连击清零 */
export function markRetry(sid) {
  const all = readAll()
  if (all[String(sid)]) {
    all[String(sid)].retryAt = Date.now()
    all[String(sid)].streak = 0
  }
  appendLog({ at: Date.now(), sid: String(sid), retry: 1 })
  writeAll(all)
}
