/**
 * 主动想起 · 频率档
 * ================
 *
 * 「她刚才忽然想起」多久冒一次，由用户自己定。
 *
 * 起因（2026-11-09 群里提的）：频率是替所有人做的决定，可每个人想要的节奏不一样。
 * 有人嫌不主动，有人嫌太主动。而我调高，是所有人一起被抬高。
 *
 * 四个档：
 *   off   不冒。心跳那边也不记念头（省一次写盘）
 *   low   少（默认，等于改之前的行为）：45 分钟才允许冒一条；带出最近 3 条
 *   mid   中：15 分钟一条
 *   high  多：每轮都可以冒，带出最近 5 条
 *
 * 存本机 ~/.dsh/consciousness-spontaneous.json，不进记忆库，不影响检索。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-spontaneous.json')

export const LEVELS = {
  off: { key: 'off', label: '关', gapMin: Infinity, limit: 0, windowMin: 0 },
  low: { key: 'low', label: '少', gapMin: 45, limit: 3, windowMin: 40 },
  mid: { key: 'mid', label: '中', gapMin: 15, limit: 4, windowMin: 80 },
  high: { key: 'high', label: '多', gapMin: 0, limit: 5, windowMin: 180 },
}

const ORDER = ['off', 'low', 'mid', 'high']
const DEFAULT = 'low'

/** 读当前档。文件坏了、没写过，都回默认，不抛。 */
export function spontaneousLevel() {
  try {
    if (!existsSync(FILE)) return DEFAULT
    const j = JSON.parse(readFileSync(FILE, 'utf8'))
    const k = String(j && j.level || '').trim()
    return LEVELS[k] ? k : DEFAULT
  } catch {
    return DEFAULT
  }
}

/** 当前档的参数 */
export function spontaneousOf() {
  return LEVELS[spontaneousLevel()] || LEVELS[DEFAULT]
}

/** 改档。只认四个键，别的一律不写。 */
export function setSpontaneousLevel(k) {
  const key = String(k || '').trim()
  if (!LEVELS[key]) return { ok: false, error: '档位只有 off / low / mid / high' }
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify({ level: key, at: Date.now() }, null, 2), 'utf8')
    return { ok: true, level: key, label: LEVELS[key].label }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

/** 下一档（按 off → low → mid → high 循环），给按钮用 */
export function nextSpontaneousLevel() {
  const i = ORDER.indexOf(spontaneousLevel())
  return ORDER[(i + 1) % ORDER.length]
}

/** 现在允不允许冒一个新的念头 */
export function canThinkNow(lastAt) {
  const lv = spontaneousOf()
  if (!isFinite(lv.gapMin)) return false
  if (!lv.gapMin) return true
  const gap = Date.now() - (Number(lastAt) || 0)
  return gap >= lv.gapMin * 60000
}
