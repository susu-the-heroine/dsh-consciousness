/**
 * 审计日志
 * ======
 *
 * 每次写入、检索、注入都记一行。出问题的时候靠它回看。
 *
 * 滚动：超过 8MB 就换一个，最多留 5 份。
 * 写不进去不影响业务——日志挂了不能连累识海。
 */
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { AUDIT_FILE, AUDIT_MAX_BYTES } from './paths.js'

export function audit(kind, detail) {
  try {
    const line = JSON.stringify({
      t: Date.now(),
      k: kind,
      ...detail,
    }) + '\n'
    // 滚动：文件太大就换一个
    try {
      if (existsSync(AUDIT_FILE) && statSync(AUDIT_FILE).size > AUDIT_MAX_BYTES) {
        // 滚动 5 份，旧的覆盖更旧的
        for (let i = 4; i >= 1; i--) {
          const from = i === 1 ? AUDIT_FILE : AUDIT_FILE + '.' + (i - 1)
          const to = AUDIT_FILE + '.' + i
          try { if (existsSync(from)) renameSync(from, to) } catch {}
        }
      }
    } catch {}
    appendFileSync(AUDIT_FILE, line, 'utf8')
  } catch {
    /* 日志写不进去不影响业务 */
  }
}
