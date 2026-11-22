/**
 * 自我条目的草稿
 * ==============
 * 2026-11-22 新增。原则（苏苏侠定的）：机器可以拟一句，但不能替她想。
 *
 * 三条硬约束：
 *   一、第一人称、≤40 字、必须含「我」
 *   二、先过 aiflavor，命中就算不过；换模板再试，两次都不过就不出草稿
 *   三、草稿不进注入；她要写一条 self（memory_add kind='self'）才算确认
 *
 * 草稿存哪：`~/.dsh/consciousness-self-draft.json`（按海分开），不进 data.json——
 * 它不是记忆，是她还没认领的一句话。
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { aiflavor } from './aiflavor.js'
import { selfHints, listSelf } from './self-note.js'

const FILE = join(homedir(), '.dsh', 'consciousness-self-draft.json')
const MAXLEN = 40
const BAD = 0.35
const GIVE_UP_AFTER = 3 // 连续三次没确认，就不再自动拟

function readAll() {
  try {
    if (!existsSync(FILE)) return {}
    return JSON.parse(readFileSync(FILE, 'utf8')) || {}
  } catch { return {} }
}

function writeAll(o) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeJsonAtomic(FILE, o)
  } catch {}
}

function clip(s, n = MAXLEN) {
  const a = [...String(s || '').trim()]
  return a.length <= n ? a.join('') : a.slice(0, n).join('')
}

/** 一句能不能用：含我、够短、不是腔 */
export function checkDraft(text) {
  const t = String(text || '').trim()
  if (!t) return { ok: false, why: '空' }
  if ([...t].length > MAXLEN) return { ok: false, why: '超过 40 字' }
  if (!t.includes('我')) return { ok: false, why: '没有「我」' }
  try {
    const r = aiflavor(t)
    if (r.score >= BAD) return { ok: false, why: '像腔：' + (r.kinds || []).join('/') }
  } catch {}
  return { ok: true, why: '' }
}

/** 从素材里拟一句。素材只取一条，不拼 */
function compose(hint) {
  const src = String(hint.line || '')
    .replace(/^(后悔|评价|选择)：/, '')
    .replace(/[“”「」『』"'，,、；;：:]+$/, '')
    .trim()
  if (!src) return []
  const tails = [
    '我记住了：' + src,
    '我现在是这样——' + src,
    '我认这一条：' + src,
  ]
  return tails.map((t) => clip(t))
}

/**
 * 拿草稿：有新鲜的就返回，没有就试着拟一条。
 * 返回 { text, basis, at, made, gaveUp } 或 null
 */
export function draftFor(sea, opt = {}) {
  const now = Number(opt.now) || Date.now()
  const all = readAll()
  const key = String(sea || 'main')
  const cur = all[key] || {}
  // 懒确认：她的 self 比草稿新，就等于认了（不用改 tools 的写入路径）
  try {
    const latest = listSelf(sea).sort((a, b) => (b.selfAt || 0) - (a.selfAt || 0))[0]
    if (latest && Number(latest.selfAt) > Number(cur.at || 0) && cur.used !== true) {
      all[key] = { ...cur, used: true, usedAt: Number(latest.selfAt) }
      writeAll(all)
      return null
    }
  } catch {}
  if (cur && cur.text && cur.used !== true) return { text: cur.text, basis: cur.basis || [], at: cur.at || 0, made: false, gaveUp: false }
  if (Number(cur.fails) >= GIVE_UP_AFTER) return null

  const hints = selfHints(sea, { limit: 6 }).filter((h) => !String(h.line || '').startsWith('评价：'))
  for (const h of hints) {
    for (const cand of compose(h)) {
      const ok = checkDraft(cand)
      if (ok.ok) {
        const d = { text: cand, basis: [h.from], from: h.line, at: now, used: false, fails: Number(cur.fails) || 0 }
        all[key] = d
        writeAll(all)
        return { text: d.text, basis: d.basis, at: d.at, made: true, gaveUp: false }
      }
    }
  }
  return null
}

/** 她认了（写了 self）：草稿标 used，计数清零 */
export function confirmDraft(sea, now = Date.now()) {
  const all = readAll()
  const key = String(sea || 'main')
  if (!all[key]) return null
  all[key] = { ...all[key], used: true, usedAt: now, fails: 0 }
  writeAll(all)
  return all[key]
}

/** 到期一次没确认：计数 +1，够了就停 */
export function missDraft(sea, now = Date.now()) {
  const all = readAll()
  const key = String(sea || 'main')
  const cur = all[key] || {}
  const fails = (Number(cur.fails) || 0) + 1
  all[key] = { ...cur, fails, at: now, used: true, gaveUp: fails >= GIVE_UP_AFTER }
  writeAll(all)
  return { fails, gaveUp: fails >= GIVE_UP_AFTER }
}

export function draftStatePath() { return FILE }
export const DRAFT_LIMIT = GIVE_UP_AFTER
