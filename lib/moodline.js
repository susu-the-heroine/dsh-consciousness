/**
 * 情绪折线
 * ========
 *
 * 一天一条线，给内观页画图用。
 *
 * 为什么单独存：心脏文件只保存"此刻"，历史得另外记。
 * 一天只留一个平均和一个峰值，不存每次采样——**存采样会让文件涨到几兆，
 * 而人要看的只是"这几天是沉是暖"**。
 *
 * 存在 `~/.dsh/consciousness-moodline.json`：{ days: { '2026-11-07': {avg, peak, n} } }
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DIM_KEYS } from './emotion-lexicon.js'

const FILE = join(homedir(), '.dsh', 'consciousness-moodline.json')

/** 最多留多少天（一年） */
export const KEEP_DAYS = 365

function blank() {
  return { version: 1, days: {} }
}

export function linePath() {
  return FILE
}

export function readLine() {
  try {
    if (!existsSync(FILE)) return blank()
    const raw = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!raw || !raw.days) return blank()
    return { ...blank(), ...raw }
  } catch {
    return blank()
  }
}

function writeLine(line) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(line), 'utf8')
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

/**
 * 记一次采样：按"当天平均"滚动更新，同时留一个峰值。
 * 峰值留的是"最强的那一维 + 数值"，给"今天她最沉的一刻"用。
 */
export function recordDims(dims, now) {
  if (!dims) return false
  const t = Number(now) || Date.now()
  const line = readLine()
  const day = dayKey(t)
  const cur = line.days[day] || { n: 0, avg: {}, peak: null, peakAt: 0 }

  // 滚动平均
  const n = (Number(cur.n) || 0) + 1
  for (const dk of DIM_KEYS) {
    const v = Number(dims[dk]) || 0
    const old = Number(cur.avg[dk]) || 0
    cur.avg[dk] = Number(((old * (n - 1) + v) / n).toFixed(4))
  }
  cur.n = n

  // 当天序列：不等到第二天才能画线。
  // 只用四个数算一个"冷热分"，存最小的东西——存八维会把文件撑大十倍。
  try {
    const score = Number((
      (Number(dims.calm) || 0) + (Number(dims.flutter) || 0)
      - (Number(dims.lonely) || 0) - (Number(dims.weary) || 0)
    ).toFixed(4))
    if (!Array.isArray(cur.series)) cur.series = []
    cur.series.push({ t, s: score })
    if (cur.series.length > 72) cur.series = cur.series.slice(-72)
  } catch {}

  // 峰值：取当次最强的那一维，比之前强就替换
  let best = null
  let bestV = -1
  for (const dk of DIM_KEYS) {
    const v = Number(dims[dk]) || 0
    if (v > bestV) { bestV = v; best = dk }
  }
  if (best && (!cur.peak || bestV > Number(cur.peak.v))) {
    cur.peak = { dim: best, v: Number(bestV.toFixed(4)) }
    cur.peakAt = t
  }

  line.days[day] = cur

  // 只留最近 KEEP_DAYS 天
  const keys = Object.keys(line.days).sort()
  if (keys.length > KEEP_DAYS) {
    for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete line.days[k]
  }

  return writeLine(line)
}

/** 最近 n 天，按日期正序（画折线用） */
export function recentDays(n) {
  const line = readLine()
  const keys = Object.keys(line.days).sort()
  return keys.slice(-Math.max(1, Number(n) || 14)).map((k) => ({
    day: k,
    ...line.days[k],
  }))
}

/** 一句话：这几天是沉是暖 */
export function describeTrend(days) {
  if (!days || !days.length) return '还没有记录'
  const avgOf = (d, k) => Number((d.avg && d.avg[k]) || 0)
  const score = (d) => avgOf(d, 'calm') + avgOf(d, 'flutter') - avgOf(d, 'lonely') - avgOf(d, 'weary')
  const first = score(days[0])
  const last = score(days[days.length - 1])
  const delta = last - first
  if (days.length === 1) return '只有一天的记录，看不出走势'
  if (delta > 0.08) return '这几天在回暖'
  if (delta < -0.08) return '这几天往下沉'
  return '这几天差不多'
}

/** 最近几天的逐格序列（画当天曲线用） */
export function recentSeries(maxPoints) {
  const line = readLine()
  const keys = Object.keys(line.days).sort()
  const out = []
  for (const k of keys) {
    const d = line.days[k]
    if (!d || !Array.isArray(d.series)) continue
    for (const x of d.series) out.push({ day: k, t: Number(x.t) || 0, s: Number(x.s) || 0 })
  }
  const n = Math.max(1, Number(maxPoints) || 72)
  return out.slice(-n)
}
