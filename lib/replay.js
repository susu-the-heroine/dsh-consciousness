/**
 * 历史查询回放
 * ============
 *
 * 把检索日志里记过的问句重新跑一遍，看「原来排第一的那条，现在还排第一吗」。
 * 这不是测准，是测稳——改动前后跑同一批问句，掉出去的就是被改坏的。
 *
 * 有一条要分开算：老日志里有一部分是当年答错的（第一名跟问句连一个字都不沾），
 * 现在被拒答掉是变好，不是退化。这种记进 changedBetter，不进稳定率。
 */
import { existsSync, readFileSync } from 'node:fs'
import { SEARCH_LOG_FILE } from './paths.js'

/** 把日志文本拆成检索记录（只留 k==='s' 且原问句不空的） */
export function parseLogLines(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const j = JSON.parse(s)
      if (!j || j.k !== 's' || !j.q) continue
      if (!Array.isArray(j.top) || !j.top.length) continue
      out.push(j)
    } catch {}
  }
  return out
}

export function readLogEntries(limit = 200) {
  try {
    if (!existsSync(SEARCH_LOG_FILE)) return []
    const all = parseLogLines(readFileSync(SEARCH_LOG_FILE, 'utf8'))
    return all.slice(-Math.max(1, limit))
  } catch {
    return []
  }
}

const pctOf = (arr, p) => {
  if (!arr.length) return 0
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
}

function bigrams(s) {
  const x = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '')
  const out = new Set()
  for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2))
  return out
}

/**
 * 回放一批。searchFn 只要求返回 { ids: [...], ms } 形状。
 * 判稳：老的第一名还在新结果的前 top 名里，就算没掉。
 */
export async function replay(entries, searchFn, opt = {}) {
  const top = Math.max(1, Number(opt.top) || 3)
  const rows = []
  for (const e of Array.isArray(entries) ? entries : []) {
    const want = Number((e.top[0] || {}).id)
    if (!Number.isFinite(want)) continue

    // 老第一名跟问句有没有字面关系：没有的，当年就是答错，现在拒答是变好
    const qa = bigrams(e.q)
    const ta = bigrams((e.top[0] || {}).t)
    let hit = 0
    for (const g of qa) if (ta.has(g)) hit++
    const meaningful = hit > 0

    let got = null
    let ms = 0
    try {
      const r = await searchFn(e.q, e.sea || 'main')
      if (r && Array.isArray(r.ids)) { got = r.ids.map(Number); ms = Number(r.ms) || 0 }
    } catch {}

    if (!got) {
      // 2026-11-20：查询没跑成（抛了、或者没回结果）也记 ok:false。汇总那行「变好了」
      // 只排除「没有字面关系」的，于是跑挂的行被当成「变好」——真挂一片反而显得更健康。
      // 跑挂单独标一个记号，后面两边都不算它。
      rows.push({ q: e.q, sea: e.sea, want, ok: false, rank: 0, ms, meaningful, errored: true })
      continue
    }
    const rank = got.indexOf(want)
    rows.push({
      q: e.q,
      sea: e.sea,
      want,
      ok: rank >= 0 && rank < top,
      rank: rank < 0 ? 0 : rank + 1,
      ms,
      meaningful,
    })
  }

  const key = rows.filter((r) => r.meaningful)
  const okN = key.filter((r) => r.ok).length
  const ms = rows.map((r) => r.ms).filter((x) => x > 0)
  return {
    n: rows.length,
    meaningful: key.length,
    changedBetter: rows.filter((r) => !r.ok && !r.meaningful && !r.errored).length,
    errored: rows.filter((r) => r.errored).length,
    stable: key.length ? okN / key.length : 0,
    moved: rows.filter((r) => !r.ok && r.meaningful).slice(0, 10),
    p50: pctOf(ms, 50),
    p95: pctOf(ms, 95),
    rows,
  }
}
