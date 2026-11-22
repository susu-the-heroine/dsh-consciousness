/**
 * 体检与快照
 * ==========
 *
 * 2026-11-18 加。之前只有「此刻」的覆盖率，没有历史——
 * 掉到九十四那天开始坏的，没人知道。
 *
 * 这里做三件小事：
 *   每天每个海存一份快照（同一天只存一条）
 *   按阈值报红：覆盖低于 95、队列连两小时不清、p95 超过 200ms
 *   每周汇总一份报告，落一个文件，工作台能读
 *
 * 定时由 index.js 的计时器调，也能手动跑 scripts/health-check.mjs。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { localDay } from './day.js'

const DIR = () => join(homedir(), '.dsh')
const DAY = 86400000

export const snapPath = () => join(DIR(), 'consciousness-health.jsonl')
export const weeklyPath = () => join(DIR(), 'consciousness-weekly.json')

const dayKey = (t) => localDay(t)

/** 记一条快照；同一天同一个海只留第一条 */
export function recordSnapshot(sea, health, now = Date.now()) {
  try {
    if (!sea || !health) return { added: false }
    mkdirSync(DIR(), { recursive: true })
    const k = dayKey(now)
    const old = readSnapshots(sea, 3)
    if (old.some((x) => dayKey(x.t) === k)) return { added: false }
    const line = JSON.stringify({
      t: now,
      sea,
      coverage: Number(health.coverage) || 0,
      stale: Number(health.stale_rate) || 0,
      queued: Number(health.queued) || 0,
      p95: Number(health.p95_ms) || 0,
      bytes: Number(health.bytes) || 0,
      total: Number(health.total) || 0,
    })
    appendFileSync(snapPath(), line + '\n', 'utf8')
    return { added: true }
  } catch {
    return { added: false }
  }
}

/** 读某海最近 N 天快照（旧到新） */
export function readSnapshots(sea, days = 30) {
  try {
    const p = snapPath()
    if (!existsSync(p)) return []
    const since = Date.now() - days * DAY
    const out = []
    for (const l of readFileSync(p, 'utf8').split('\n')) {
      if (!l.trim()) continue
      try {
        const o = JSON.parse(l)
        if (!o || (sea && o.sea !== sea)) continue
        if (Number(o.t) < since) continue
        out.push(o)
      } catch {}
    }
    out.sort((a, b) => a.t - b.t)
    return out
  } catch {
    return []
  }
}

/** 按阈值报红 */
export function alertsFor(sea) {
  const list = readSnapshots(sea, 7)
  const last = list[list.length - 1]
  const out = []
  if (!last) return out
  if (Number(last.coverage) < 95) out.push({ code: 'coverage-low', level: 'warn', text: '覆盖 ' + Number(last.coverage).toFixed(1) + '%，低于 95%' })
  if (Number(last.p95) > 200) out.push({ code: 'slow', level: 'warn', text: '检索 p95 ' + last.p95 + 'ms，超过 200ms' })
  // 队列：最新一条有、且两小时前那条也有 → 卡住
  if (Number(last.queued) > 0) {
    // 2026-11-20：原来是「七天内任意一条有过队列」就报「两小时没清」——昨天堵过一次、
    // 今天刚排队五分钟也会报。改成看两小时前**那一条**：它也堵着，才算连着没清。
    const twoH = (Number(last.t) || Date.now()) - 2 * 3600000
    const before = list.filter((x) => Number(x.t) <= twoH)
    const prev = before.length ? before[before.length - 1] : null
    if (prev && Number(prev.queued) > 0) {
      out.push({ code: 'queue-stuck', level: 'bad', text: '队列 ' + last.queued + ' 条，两小时没清' })
    }
  }
  return out
}

/** 每周汇总：每个海当前健康度 + 告警 */
export async function weeklyReport(now = Date.now()) {
  const { SEAS_DIR } = await import('./paths.js')
  const { readSea } = await import('./store.js')
  const { vectorHealth } = await import('./vectors.js')
  const seas = []
  try {
    for (const name of readdirSync(SEAS_DIR)) {
      try {
        const d = readSea(name)
        if (!d) continue
        const h = vectorHealth(name, d)
        const al = alertsFor(name)
        seas.push({ sea: name, total: h.total, coverage: h.coverage, stale: h.stale_rate, queued: h.queued, p95: h.p95_ms, alerts: al.length })
      } catch {}
    }
  } catch {}
  const bad = seas.filter((s) => s.alerts > 0)
  const report = {
    at: now,
    seas: seas.length,
    points: seas.reduce((n, s) => n + (Number(s.total) || 0), 0),
    worstCoverage: seas.length ? Math.min(...seas.map((s) => Number(s.coverage) || 0)) : 100,
    bad,
    items: seas,
  }
  try {
    const p = weeklyPath()
    let list = []
    try { list = JSON.parse(readFileSync(p, 'utf8')) } catch {}
    if (!Array.isArray(list)) list = []
    list.push(report)
    // 2026-11-20：这文件是历史清单，直接覆盖写——写一半断了整份就白攒。
    // 跟别处一样：先临时再改名。
    const tmp = p + '.tmp'
    writeFileSync(tmp, JSON.stringify(list.slice(-12)), 'utf8')
    renameSync(tmp, p)
  } catch (e) {
    // 2026-11-21：周报历史写不进去原来整段吞掉，函数照样把周报交回去，看着一切正常。
    // 实测：把那个 .tmp 的位置先占成目录，写失败、历史文件压根不存在、返回的对象里一句提示都没有。
    // 结果就是「每周六看一眼趋势」这条线悄悄断掉。现在把话挂在返回的周报上。
    report.historyWarn = '这周的周报没写进历史：' + String((e && e.message) || e).slice(0, 80)
  }
  return report
}

export function weeklyReport_() {
  try { return JSON.parse(readFileSync(weeklyPath(), 'utf8')) } catch { return [] }
}
