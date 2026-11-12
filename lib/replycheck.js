/**
 * 回看她的上一句
 * =============
 * DSH 给了 agent/turn-stopping：能读到她刚说的话，但改不了。
 * 所以这里做的是「回看 + 记账」：太像稿子就记一笔，下一轮注入里提醒她重说。
 *
 * 这不是硬约束，是闭环里的软纠正——但至少不用人盯着。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-replycheck.json')
import { aiflavor } from './aiflavor.js'
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
    writeFileSync(FILE, JSON.stringify(o), 'utf8')
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
  const shortBad = short != null && short < 0.18
  const all = readAll()
  const cur = all[String(sid)] || {}
  // 有腔、或者短句不像她，都算一次；单次可能是引用或代码块，所以连续两次才提醒
  const badNow = r.score >= 0.35 || shortBad
  const streak = badNow ? (Number(cur.streak) || 0) + 1 : 0
  all[String(sid)] = {
    streak,
    last: r.score,
    kinds: shortBad ? [...(r.kinds || []), '短句没味'] : r.kinds,
    short,
    at: Date.now(),
  }
  writeAll(all)
  return { score: r.score, kinds: r.kinds, streak }
}

/** 开下一轮之前取一次：要不要提醒，取了就清 */
export function takeWarning(sid) {
  const all = readAll()
  const cur = all[String(sid)]
  if (!cur) return ''
  if ((Number(cur.streak) || 0) < 2) return ''
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
  if ((Number(cur.streak) || 0) < 2) return false
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
  writeAll(all)
}
