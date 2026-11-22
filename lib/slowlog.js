/**
 * 慢查询清单
 * ==========
 *
 * 超过阈值的检索记一条：什么时候、哪个海、问的什么、各段多久。
 * 只留最后 2000 行，不涨到把盘撑爆。
 *
 * 阈值：C2_SLOW_MS，默认 100 毫秒。
 * 文件：~/.dsh/consciousness-sim/slow-search.jsonl
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.dsh', 'consciousness-sim')
const FILE = join(DIR, 'slow-search.jsonl')
const MAX_LINES = 2000

export function slowPath() {
  return FILE
}

export function slowThreshold() {
  const n = Number(process.env.C2_SLOW_MS)
  return Number.isFinite(n) && n > 0 ? n : 100
}

/** 记一条。ms 不够阈值就什么都不做。 */
export function noteSlow(rec) {
  try {
    if (!rec || !(Number(rec.ms) >= slowThreshold())) return false
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
    const line = JSON.stringify({
      t: Date.now(),
      ms: Math.round(Number(rec.ms) * 10) / 10,
      sea: String(rec.sea || 'main'),
      q: String(rec.q || '').slice(0, 200),
      seg: rec.seg || null,
    }) + '\n'
    appendFileSync(FILE, line)
    trimIfNeeded()
    return true
  } catch {
    return false
  }
}

function trimIfNeeded() {
  try {
    const txt = readFileSync(FILE, 'utf8')
    const lines = txt.split('\n').filter(Boolean)
    if (lines.length <= MAX_LINES) return
    writeFileSync(FILE, lines.slice(-MAX_LINES).join('\n') + '\n')
  } catch {}
}

/** 读最近 n 条（新的在前） */
export function readSlow(n = 20) {
  try {
    const lines = readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-Math.max(1, n)).reverse().map((x) => {
      try { return JSON.parse(x) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

/** 统计：条数、中位、最慢 */
export function slowStats() {
  const all = readSlow(MAX_LINES)
  // 2026-11-20：这里自己又算了一遍阈值（写成「读得到就用、否则一百」），跟记一条那儿的规矩不一样。
  // 环境变量写成零或负数时——记的时候按一百，报的时候按零，界面上的阈值跟实际用的对不上。统一走一个函数。
  const th = slowThreshold()
  if (!all.length) return { n: 0, p50: 0, max: 0, threshold: th, recent: [] }
  const ms = all.map((x) => Number(x.ms) || 0).sort((a, b) => a - b)
  return {
    n: all.length,
    p50: ms[Math.floor(ms.length / 2)],
    max: ms[ms.length - 1],
    threshold: th,
    // 工作台上要摆清单，光给统计不够（2026-11-19）
    recent: all.slice().sort((a, b) => (Number(b.ms) || 0) - (Number(a.ms) || 0)).slice(0, 10)
      .map((x) => ({ ms: Number(x.ms) || 0, q: String(x.q || '').slice(0, 60) })),
  }
}
