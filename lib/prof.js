/**
 * 检索分段计时
 * ============
 *
 * 只在 C2_PROF=1 时工作，默认零开销——注意，连 performance.now 都不调。
 *
 * 用法：一次检索里 begin() 起表，mark('名') 记一段，finish() 收尾并推进环形缓冲。
 * 脚本 scripts/bench-segments.mjs 读 recent，出 p50/p95。
 */
const on = () => String(process.env.C2_PROF || '') === '1'

/** 最近若干次的拆段结果（每次一个对象，键是段名，值是毫秒） */
export const recent = []
const CAP = 200

let cur = null
let last = 0

export function begin() {
  if (!on()) { cur = null; return null }
  cur = { t: performance.now(), marks: {} }
  last = cur.t
  return cur
}

export function mark(name) {
  if (!on() || !cur) return
  try {
    const n = performance.now()
    const ms = Math.round((n - last) * 100) / 100
    // 2026-11-20：同名段第二次打点原来是覆盖——「向量」分两趟查的时候，头一趟的耗时被抹掉，
    // 报表上这一段永远偏小。同名就累加。
    cur.marks[name] = Math.round(((cur.marks[name] || 0) + ms) * 100) / 100
    last = n
  } catch {}
}

export function finish(extra) {
  if (!on() || !cur) return null
  try {
    const total = Math.round((performance.now() - cur.t) * 100) / 100
    const rec = { ...cur.marks, total, ...(extra && typeof extra === 'object' ? extra : {}) }
    recent.push(rec)
    if (recent.length > CAP) recent.shift()
    return rec
  } finally {
    cur = null
  }
}

export function enabled() {
  return on()
}
