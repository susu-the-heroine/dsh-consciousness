/**
 * 风格管道的熔断器
 * ================
 * 2026-11-22 加。上一版把识海写卡死过：注入里读 171 MB raw、写 241 MB 海，
 * 消息发不出去也不报错。以后这段只要慢，就自己断电，不许再赌。
 *
 * 规矩：
 *   - 注入里给这段计时；超过 BUDGET_MS（默认 200）就写 off:true，之后永不跑。
 *   - 关了就关了，不会自己恢复；要开回来，删掉 ~/.dsh/consciousness-style-cost.json 或改成 off:false。
 *   - 每次跑完记一条耗时（只留最后 20 条），方便看趋势。
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

const FILE = `${homedir()}/.dsh/consciousness-style-cost.json`
const BUDGET_MS = 200

function read() {
  try {
    if (!existsSync(FILE)) return {}
    const o = JSON.parse(readFileSync(FILE, 'utf8'))
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}

function write(o) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeJsonAtomic(FILE, o)
  } catch {}
}

/** 该不该跑。返回 { run: boolean, why: string } */
export function shouldRun() {
  const s = read()
  if (s.off === true) return { run: false, why: '熔断过：' + String(s.why || '超过预算') }
  return { run: true, why: '' }
}

/** 跑完记一笔；超预算就断电 */
export function recordCost(ms, note = '') {
  const s = read()
  const took = Math.max(0, Math.round(Number(ms) || 0))
  const recent = Array.isArray(s.recent) ? s.recent.slice(-19) : []
  recent.push({ at: Date.now(), ms: took, note })
  const next = { ...s, recent }
  if (took > BUDGET_MS) {
    next.off = true
    next.why = '这次跑了 ' + took + ' ms，超过 ' + BUDGET_MS + ' ms' + (note ? '（' + note + '）' : '')
    next.offAt = Date.now()
  }
  write(next)
  return { off: next.off === true, ms: took }
}

/** 手动恢复（清掉熔断标记，保留历史） */
export function resetBreaker() {
  const s = read()
  s.off = false
  s.why = ''
  s.resetAt = Date.now()
  write(s)
  return s
}

export function breakerPath() { return FILE }
export const BUDGET = BUDGET_MS
