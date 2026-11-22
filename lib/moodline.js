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
import { withLock } from './statefile.js'
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
// 2026-11-19 夜（P189）：情绪线也是读改写，套锁
export function recordDims(dims, now) {
  return withLock(linePath(), () => _recordDims(dims, now), { waitMs: 2000 })
}

function _recordDims(dims, now) {
  if (!dims) return false
  const t = Number(now) || Date.now()
  const line = readLine()
  const day = dayKey(t)
  const cur = line.days[day] || { n: 0, avg: {}, peak: null, peakAt: 0 }
  // 2026-11-20：文件是手也能改的。老条目/手改条目少了 avg（或者写成一个数）时，
  // 下面 cur.avg[dk] 直接抛，整次采样丢掉。先补成对象。
  // 缺了就补成空对象，并且把次数清零——不能拿「次数三」去配「空格子」，
  // 那等于把前三次当成全零来平均，第一口就把线拽到 0.2。重头算才准。
  if (!cur.avg || typeof cur.avg !== 'object') {
    cur.avg = {}
    cur.n = 0
  }

  // 滚动平均
  const n = (Number(cur.n) || 0) + 1
  for (const dk of DIM_KEYS) {
    // 2026-11-20：八维都在 0~1。谁传进来 5 或 -3 都得夹住，不然折线图刻度会被撑坏。
    const v = Math.max(0, Math.min(1, Number(dims[dk]) || 0))
    const old = Number(cur.avg[dk]) || 0
    cur.avg[dk] = Number(((old * (n - 1) + v) / n).toFixed(4))
  }
  cur.n = n

  // 当天序列：不等到第二天才能画线。
  // 只用四个数算一个"冷热分"，存最小的东西——存八维会把文件撑大十倍。
  try {
    // 2026-11-20：上面夹的是 avg/peak，这条当日序列的分没夹——传 5 进来，点就飞到 5，
    // 折线图的刻度被这一个点撑坏。四个维度先夹再算。
    const _c = (k) => Math.max(0, Math.min(1, Number(dims[k]) || 0))
    const score = Number((_c('calm') + _c('flutter') - _c('lonely') - _c('weary')).toFixed(4))
    if (!Array.isArray(cur.series)) cur.series = []
    cur.series.push({ t, s: score })
    if (cur.series.length > 72) cur.series = cur.series.slice(-72)
  } catch {}

  // 峰值：取当次最强的那一维，比之前强就替换
  let best = null
  let bestV = -1
  for (const dk of DIM_KEYS) {
    const v = Math.max(0, Math.min(1, Number(dims[dk]) || 0))
    if (v > bestV) { bestV = v; best = dk }
  }
  if (best && (!cur.peak || bestV > Number(cur.peak.v))) {
    cur.peak = { dim: best, v: Number(bestV.toFixed(4)) }
    cur.peakAt = t
  }

  line.days[day] = cur

  // 只留最近 KEEP_DAYS 天
  const keys = Object.keys(line.days).sort()
  // 2026-11-20：原来只按「条数」裁——库里就两三天时，两年前那条永远留着。
  // 内观页画的是「最近的日子」，按日期裁才对：超过 KEEP_DAYS 天的一律清掉。
  try {
    const cut = new Date(Date.now() - KEEP_DAYS * 86400000)
    const z = (n) => String(n).padStart(2, '0')
    const cutKey = cut.getFullYear() + '-' + z(cut.getMonth() + 1) + '-' + z(cut.getDate())
    for (const k of keys) if (k < cutKey) delete line.days[k]
  } catch {}
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
