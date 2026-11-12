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
export function capParts(parts, max) {
  const limit = Number(max) || readLive().capMax || MAX_CHARS
  const src = Array.isArray(parts) ? parts.slice() : []
  const out = []
  let used = 0

  for (let i = 0; i < src.length; i++) {
    const seg = String(src[i] == null ? '' : src[i])
    // 换行只在两段之间算一次：第一段不该被多扣一个字符
    const add = seg.length + (out.length ? 1 : 0)
    if (used + add > limit) {
      // 截了：末行说清，别让模型以为后面没有
      const note = '（上下文太长，后面的先不塞了）'
      const noteAdd = note.length + (out.length ? 1 : 0)
      if (used + noteAdd <= limit) {
        out.push(note)
        used += noteAdd
      }
      return { parts: out, truncated: true, used }
    }
    out.push(seg)
    used += add
  }
  return { parts: out, truncated: false, used }
}

/** 必保块在不在（丢了就是设计坏了） */
export function hasMustKeep(parts) {
  const text = (parts || []).join('\n')
  return MUST_KEEP.filter((k) => !text.includes(k))
}
