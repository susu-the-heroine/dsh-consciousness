/**
 * 档位
 * ====
 *
 * 三档，决定开几层检索、注入几条：
 *   low  —— 字面 + 注入 3 条。省 token，慢机器用
 *   high —— 加向量、实体。默认
 *   max  —— 全开：加图游走，注入 7 条
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { QUALITY_FILE } from './paths.js'
import { audit } from './log.js'

/* 档位状态。启动时从文件读一次，之后只改内存 + 回写文件。
 * 全局单一状态源——所有模块读同一个，不会出现「Max 假放开」。 */
let _QUALITY = (function () {
  try {
    if (existsSync(QUALITY_FILE)) {
      const o = JSON.parse(readFileSync(QUALITY_FILE, 'utf8'))
      if (o && (o.quality === 'low' || o.quality === 'high' || o.quality === 'max')) return o.quality
    }
  } catch {}
  return 'high'
})()

/** 当前档位字符串 */
export function qualityOf() {
  return _QUALITY
}

/* 换档。写文件 + 立刻生效，不用重启 */
export function setQuality(q) {
  if (q !== 'low' && q !== 'high' && q !== 'max') return false
  _QUALITY = q
  // 2026-11-20：写盘失败原来也回成功——这一轮看着是换了档，重启又回旧档。
  // 内存照改（立刻生效），但要把「没存住」说出来。
  const _saved = writeJsonAtomic(QUALITY_FILE, { quality: q })
  audit('quality', { q, saved: _saved })
  return _saved
}

export function qualityRank() {
  return _QUALITY === 'max' ? 3 : (_QUALITY === 'high' ? 2 : 1)
}

/* 这一档开不开某个东西 */
export function qOn(feature) {
  const r = qualityRank()
  if (feature === 'vector') return r >= 2
  if (feature === 'entity') return r >= 2
  if (feature === 'graph') return r >= 3
  if (feature === 'inject-full') return r >= 3
  return true
}
