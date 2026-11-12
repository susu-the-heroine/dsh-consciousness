/**
 * 关系历史
 * ========
 *
 * 关系状态机每次现算，算出来就扔——于是"关系是怎么变过来的"没有痕迹。
 * 这一层只做一件事：**每天存一格**，让"咱们"这两个字有曲线。
 *
 * 存在 `~/.dsh/consciousness-relation.json`：{ days: { '2026-11-07': {stage, score, trust, kept, broken, events} } }
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { relationScore, stageOf, trustOf, STAGES } from './relation.js'

const FILE = join(homedir(), '.dsh', 'consciousness-relation.json')
export const KEEP_DAYS = 400

function blank() {
  return { version: 1, days: {} }
}

export function pathOf() {
  return FILE
}

export function readHistory() {
  try {
    if (!existsSync(FILE)) return blank()
    const raw = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!raw || !raw.days) return blank()
    return { ...blank(), ...raw }
  } catch {
    return blank()
  }
}

function writeHistory(h) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(h), 'utf8')
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

/** 存今天这一格（同一天重复调用只覆盖，不会写多条） */
export function recordToday(stat, now) {
  const t = Number(now) || Date.now()
  const h = readHistory()
  const day = dayKey(t)
  h.days[day] = {
    score: relationScore(stat),
    stage: stageOf(stat),
    trust: trustOf(stat),
    events: Number(stat.events) || 0,
    kept: Number(stat.kept) || 0,
    broken: Number(stat.broken) || 0,
    at: t,
  }
  const keys = Object.keys(h.days).sort()
  if (keys.length > KEEP_DAYS) for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete h.days[k]
  return writeHistory(h)
}

/** 最近 n 天，按日期正序 */
export function recentHistory(n) {
  const h = readHistory()
  const keys = Object.keys(h.days).sort()
  return keys.slice(-Math.max(1, Number(n) || 14)).map((k) => ({ day: k, ...h.days[k] }))
}

/** 一句话：这段关系是怎么走到今天的 */
export function describeHistory(days) {
  if (!days || days.length < 2) return ''
  const first = days[0]
  const last = days[days.length - 1]
  if (first.stage === last.stage) {
    const delta = Number(last.score || 0) - Number(first.score || 0)
    if (delta > 1) return '还是' + last.stage + '，但比前几天近了一点'
    if (delta < -1) return '还是' + last.stage + '，但比前几天远了一点'
    return ''
  }
  const i0 = STAGES.indexOf(first.stage)
  const i1 = STAGES.indexOf(last.stage)
  return i1 > i0
    ? '从' + first.stage + '走到了' + last.stage
    : '从' + first.stage + '退回了' + last.stage
}
