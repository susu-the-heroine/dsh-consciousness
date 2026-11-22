/**
 * 注入体积上限
 * ============
 *
 * 三个新块一加就会挤占对话预算，所以必须有硬上限。
 * 抽成独立函数是为了**能单测**：内联在 buildText 里测不了。
 *
 * 规则：
 *   一、按顺序拼，超了就截，截出来的末行写明"后面的先不塞了"
 *   二、**先保命再保信息**：一定要留下【她这会儿】，那是她自己
 *   三、上限按字符算（中文一字一算，够用）
 */

// 上限改成热参数：改数字不用重启（逻辑改动仍要重启）
import { readLive } from './live.js'
export const MAX_CHARS = 2200

/** 必须有、且尽量别被截掉的那几块（按前缀匹配） */
export const MUST_KEEP = [
  '【她这会儿】',
  '【识海 · 记忆上下文】',
  // 规矩比往事重要：压缩能缩事，不能缩规矩。
  // 2026-11-11：cql 被缩没一次，行为当场退回默认。
  '【规矩·不许忘】',
]

/**
 * @param parts 段落数组
 * @param max   上限
 * @returns {parts, truncated, used}
 */
/** 这段是不是"必保块"（按前缀或包含判断） */
function isMustKeep(seg) {
  const s = String(seg == null ? '' : seg)
  if (!s) return false
  for (const k of MUST_KEEP) {
    if (!k) continue
    if (s.startsWith(k) || s.includes(k)) return true
  }
  return false
}

export function capParts(parts, max) {
  const limit = Number(max) || readLive().capMax || MAX_CHARS
  const src = Array.isArray(parts) ? parts.slice() : []
  const out = []
  let used = 0

  // 必保块先占坑：预算再紧，也不许被前面塞满的往事挤掉。
  // 2026-11-14：实测把【规矩·不许忘】放到队尾就静默消失——原来只靠"排在前面"这种位置巧合，
  // 现在改成显式预留。顺序不动，只保证它们一定进得来。
  const keep = src.map((x) => isMustKeep(x))
  let reserve = 0
  for (let i = 0; i < src.length; i++) {
    if (keep[i]) reserve += String(src[i]).length + 1
  }

  let truncated = false
  const dropped = []
  for (let i = 0; i < src.length; i++) {
    const seg = String(src[i] == null ? '' : src[i])
    const add = seg.length + (out.length ? 1 : 0)

    if (keep[i]) {
      out.push(seg)
      used += add
      reserve -= seg.length + 1
      continue
    }

    // 普通段塞不下就停：后面不再塞往事，但**必保块照进**
    if (truncated || used + add > limit - reserve) {
      truncated = true
      // 记下被砍的是哪一块（只留首行，够认人了）
      if (dropped.length < 6) dropped.push(seg.split('\n')[0].slice(0, 24))
      continue
    }
    out.push(seg)
    used += add
  }

  if (truncated) {
    const note = '（上下文太长，后面的先不塞了）'
    const noteAdd = note.length + (out.length ? 1 : 0)
    if (used + noteAdd <= limit) {
      out.push(note)
      used += noteAdd
    }
  }
  return { parts: out, truncated, used, dropped }
}

/** 必保块在不在（丢了就是设计坏了）
 * 2026-11-20 逐行核对：名字像「有没有」，实际回的是「缺了哪几个」——空数组才代表都在。
 * 全文件没人调它，先按真实语义写清，免得下一个人 `if (hasMustKeep(x))` 用反。
 */
export function hasMustKeep(parts) {
  const text = (parts || []).join('\n')
  return MUST_KEEP.filter((k) => !text.includes(k))
}
