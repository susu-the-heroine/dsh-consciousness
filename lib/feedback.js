/**
 * 反馈回流
 * ========
 *
 * 2026-11-18 加。之前 judge 只记了个好坏，没进训练的回路里——
 * 系统知道自己错了，但权重不知道。
 *
 * 这里做最窄的一步：judge 判错（miss/wrong）时，把「问的是什么、该是哪条、
 * 实际给了哪条」落一行。训练脚本把这批当硬负样本吃进去。
 *
 * 不自动重训：一次重训要跑几十秒、还会换掉线上排序，得有人点头。
 * 这里只负责攒样本、报个数。
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AUDIT_FILE } from './paths.js'

export const feedbackPath = () => join(homedir(), '.dsh', 'consciousness', 'feedback.jsonl')

export function appendFeedback(rec) {
  try {
    if (!rec || !rec.q) return false
    const dir = join(homedir(), '.dsh', 'consciousness')
    mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({
      at: Date.now(),
      q: String(rec.q).slice(0, 200),
      expect: Number(rec.expect) || 0,
      got: Number(rec.got) || 0,
      verdict: String(rec.verdict || ''),
      sea: String(rec.sea || 'main'),
    })
    appendFileSync(feedbackPath(), line + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

export function readFeedback(limit = 5000) {
  try {
    const p = feedbackPath()
    if (!existsSync(p)) return []
    const txt = readFileSync(p, 'utf8').trim()
    if (!txt) return []
    const lines = txt.split('\n').slice(-limit)
    const out = []
    for (const l of lines) {
      try { const o = JSON.parse(l); if (o && o.q) out.push(o) } catch {}
    }
    return out
  } catch {
    return []
  }
}

/**
 * 从审计日志里倒着找这一海上一次「问的是什么」。
 * 为什么不靠内存变量：检索可能提前返回（时间词、拒答），那条路记不到；
 * 审计是必然落盘的，倒着扫两百 KB 就够，比漏样本强。
 */
export function rememberQuery(sea, q) {
  try {
    const dir = join(homedir(), '.dsh', 'consciousness')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'last-query.json'), JSON.stringify({ at: Date.now(), sea: String(sea || 'main'), q: String(q || '').slice(0, 200) }), 'utf8')
    return true
  } catch { return false }
}

export function lastSearchQuery(sea) {
  try {
    const lp = join(homedir(), '.dsh', 'consciousness', 'last-query.json')
    if (existsSync(lp)) {
      const o = JSON.parse(readFileSync(lp, 'utf8'))
      // 2026-11-20：参数 sea 原来根本没看——在海 A 问完、去海 B 判错，
      // 会把海 A 的问句当成海 B 的问句落进样本。同海才认。
      const want = String(sea || 'main')
      if (o && o.q && String(o.sea || 'main') === want) return String(o.q)
    }
  } catch {}
  try {
    const p = AUDIT_FILE
    if (!existsSync(p)) return ''
    const st = statSync(p)
    const start = Math.max(0, st.size - 200 * 1024)
    const txt = readFileSync(p).subarray(start).toString('utf8')
    const lines = txt.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"k":"search"')) continue
      try {
        const o = JSON.parse(lines[i])
        if (o && o.k === 'search' && (o.q || o.query)) return String(o.q || o.query)
      } catch {}
    }
  } catch {}
  return ''
}
export function feedbackStats() {
  try {
    const p = feedbackPath()
    // 2026-11-20：原来整份读两遍（一遍数行、一遍筛可用）——反馈一多就是双倍 IO。
    // 读一遍，两个数从同一份里出。
    const all = existsSync(p) ? readFeedback(1e9) : []
    const n = all.length
    const usable = all.filter((r) => Number(r.expect) > 0).length
    let bytes = 0
    try { bytes = existsSync(p) ? statSync(p).size : 0 } catch {}
    return { lines: n, usable, bytes }
  } catch {
    return { lines: 0, usable: 0, bytes: 0 }
  }
}
