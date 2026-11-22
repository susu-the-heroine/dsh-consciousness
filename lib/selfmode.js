/**
 * 自心模式 · 三档开关
 * ==================
 *
 * low  = 全停。注入和以前一模一样，diff 为零。
 * high = 只跑算的：八维演化、联想、心事重量。**一条 token 都不烧。**
 * max  = 再加第三层：低频调模型写一句念头。有闸门，有熔断。
 *
 * 为什么分三档不分两档：一二层根本不花钱，关掉它太亏。
 * 第二档是"活着但不说话"，第三档才是"会自己写下念头"。
 *
 * 熔断：max 档超每日预算、或连续失败三次 → 自动退回 high，并写一行 audit。
 * **不许悄悄烧，也不许悄悄停。**
 */
import { withLock } from './statefile.js'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { audit } from './log.js'

// 测试可以指定别处的文件
const FILE = String(process.env.DSH_SELFMODE_FILE || '').trim()
  || join(homedir(), '.dsh', 'consciousness-selfmode.json')

export const LEVELS = ['low', 'high', 'max']

/** 每日闸门（只有 max 档用到） */
export const DAILY_THOUGHT_LIMIT = 3
export const DAILY_TOKEN_LIMIT = 40000

function blank() {
  return {
    version: 1,
    level: 'low',        // 默认关：装上不会自己开始烧钱
    day: '',
    thoughtsToday: 0,
    tokensToday: 0,
    failures: 0,
    trippedAt: 0,        // 最近一次熔断时间
    trippedReason: '',
  }
}

export function modePath() {
  return FILE
}

export function readMode() {
  try {
    if (!existsSync(FILE)) return blank()
    const raw = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!raw || !LEVELS.includes(raw.level)) return blank()
    return { ...blank(), ...raw }
  } catch {
    return blank()
  }
}

export function writeMode(m) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(m), 'utf8')
    renameSync(tmp, FILE)
    return true
  } catch {
    return false
  }
}

function dayKey(ts) {
  const d = new Date(Number(ts) || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 换天就把当日计数清零 */
function rollDay(m, now) {
  const today = dayKey(now)
  if (m.day !== today) {
    m.day = today
    m.thoughtsToday = 0
    m.tokensToday = 0
  }
  return m
}

/** 设档位 */
// 2026-11-19 夜（P189）：自模式是读改写，套锁，锁里清缓存
export function setLevel(level, now) {
  return withLock(modePath(), () => _setLevel(level, now), { waitMs: 2000 })
}

function _setLevel(level, now) {
  if (!LEVELS.includes(level)) return { ok: false, reason: '只有 low / high / max 三档' }
  const m = rollDay(readMode(), now)
  const before = m.level
  m.level = level
  // 2026-11-20：写盘失败也回 ok，等于告诉用户「开好了」，重启一看还在原档。
  if (!writeMode(m)) return { ok: false, reason: '写盘失败，档位没存住' }
  try { audit('selfmode-level', { from: before, to: level }) } catch {}
  return { ok: true, level, before }
}

/**
 * 现在能不能写第三层的念头。
 * 返回 {allowed, reason}。**要能说清为什么不让**。
 */
// 2026-11-19 夜（P189）：自模式是读改写，套锁，锁里清缓存
export function canThink(now) {
  return withLock(modePath(), () => _canThink(now), { waitMs: 2000 })
}

function _canThink(now) {
  const t = Number(now) || Date.now()
  const m = rollDay(readMode(), t)
  if (m.level !== 'max') return { allowed: false, reason: '最大档没开' }
  if (m.thoughtsToday >= DAILY_THOUGHT_LIMIT) return { allowed: false, reason: '今天写够了 ' + DAILY_THOUGHT_LIMIT + ' 条' }
  if (m.tokensToday >= DAILY_TOKEN_LIMIT) return { allowed: false, reason: '今天 token 用完了' }
  return { allowed: true, reason: '' }
}


/**
 * 2026-11-20：判额度与扣额度合成一次原子操作。
 * 原来「能不能写」和「记一次花费」是两次分别拿锁——两个并发的念头可能都判过、都去写，
 * 最后只扣了一条。额度是三条，多写一条就是多花一次钱。判和扣必须在同一把锁里做完。
 */
export function reserveThink(now) {
  return withLock(modePath(), () => {
    const t = Number(now) || Date.now()
    const m = rollDay(readMode(), t)
    if (m.level !== 'max') return { allowed: false, reason: '最大档没开' }
    if ((Number(m.thoughtsToday) || 0) >= DAILY_THOUGHT_LIMIT) return { allowed: false, reason: '今天写够了 ' + DAILY_THOUGHT_LIMIT + ' 条' }
    if ((Number(m.tokensToday) || 0) >= DAILY_TOKEN_LIMIT) return { allowed: false, reason: '今天 token 用完了' }
    m.thoughtsToday = (Number(m.thoughtsToday) || 0) + 1
    if (!writeMode(m)) return { allowed: false, reason: '额度没记上（写盘失败），这次不算数' }
    return { allowed: true, reason: '', reserved: true }
  }, { waitMs: 2000 })
}


/**
 * 2026-11-20：预占出去的额度，这次没写成，得还回来。
 * 不然模型一失败、或者池子拒收，那一条额度就永远算用掉了——三条额度，失败三次就没了，
 * 而且失败三次还会把档位熔断。用户看到的是「今天还没想，就说明天再说」。
 */
export function releaseThink(now) {
  return withLock(modePath(), () => {
    const t = Number(now) || Date.now()
    const m = rollDay(readMode(), t)
    const cur = Number(m.thoughtsToday) || 0
    if (cur <= 0) return { released: false, thoughtsToday: 0 }
    m.thoughtsToday = cur - 1
    writeMode(m)
    return { released: true, thoughtsToday: m.thoughtsToday }
  }, { waitMs: 2000 })
}

/** 记一次第三层的花费 */
// 2026-11-19 夜（P189）：自模式是读改写，套锁，锁里清缓存
export function noteThink(tokens, ok, now) {
  return withLock(modePath(), () => _noteThink(tokens, ok, now), { waitMs: 2000 })
}

function _noteThink(tokens, ok, now) {
  const t = Number(now) || Date.now()
  const m = rollDay(readMode(), t)
  if (ok) {
    // 2026-11-20：条数已经在 reserveThink 里扣过了，这里不再加一次——不然一次写会扣两条。
    m.thoughtsToday = Math.min(DAILY_THOUGHT_LIMIT, Number(m.thoughtsToday) || 0)
    m.tokensToday = (Number(m.tokensToday) || 0) + Math.max(0, Number(tokens) || 0)
    m.failures = 0
  } else {
    m.failures = (Number(m.failures) || 0) + 1
    if (m.failures >= 3 && m.level === 'max') {
      m.level = 'high'
      m.trippedAt = t
      m.trippedReason = '连续失败三次，自动退回 high'
      try { audit('selfmode-trip', { reason: m.trippedReason }) } catch {}
    }
  }
  // 超预算也熔断
  if (m.level === 'max' && m.tokensToday >= DAILY_TOKEN_LIMIT) {
    m.level = 'high'
    m.trippedAt = t
    m.trippedReason = 'token 到上限，自动退回 high'
    try { audit('selfmode-trip', { reason: m.trippedReason }) } catch {}
  }
  // 2026-11-20：这一笔（额度、熔断）存不住的话，下次还能接着烧。
  // 写不进去至少要留痕、要把「没存住」回给调用方，别当没事。
  const _saved = writeMode(m)
  if (!_saved) {
    try { audit('selfmode-write-fail', { level: m.level, tokens: m.tokensToday, thoughts: m.thoughtsToday }) } catch {}
  }
  return { ...m, persisted: _saved }
}

/** 只有这两档会动脑子 */
export function isOn(level) {
  const v = level || readMode().level
  return v === 'high' || v === 'max'
}

/** 第三层开没开 */
export function isThinking(level) {
  const v = level || readMode().level
  return v === 'max'
}

/** 一眼看懂现在的状态 */
export function describeMode(now) {
  const t = Number(now) || Date.now()
  const m = rollDay(readMode(), t)
  const label = { low: '关着', high: '活着（不花钱）', max: '会自己写念头' }[m.level] || m.level
  const extra = m.trippedAt
    ? '（曾熔断：' + m.trippedReason + '）'
    : (m.level === 'max' ? '（今天写了 ' + m.thoughtsToday + ' 条）' : '')
  return '自心：' + label + extra
}
