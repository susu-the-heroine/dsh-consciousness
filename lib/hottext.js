import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
/**
 * 热措辞：注入里最常改的那几句，改完下一轮自己生效，不用重启。
 *
 * 跟 live.js 分工：live.js 管数字（上限、阈值），这里管句子——
 * 规矩栏怎么排、态度行怎么写。都是"每轮都要重新算一遍"的东西，
 * 所以用带版本号的 import 每轮重拿一次。
 *
 * 只放措辞和判据，不放状态。2026-11-11 深夜。
 */
import { kindOf } from './emowords.js'
import { pickStance } from './stance.js'


/** 规矩栏：新到旧，最多十二条。改这里的排序或上限，下一轮就生效 */
export function rulesBlock(points) {
  const rules = (points || [])
    .filter((q) => q && !q.dead && !q.archived && q.rule === true)
    .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))
    .slice(0, 12)
  if (!rules.length) return ''
  const head = '【规矩·不许忘】\n' + rules.map((q) => '· ' + String(q.title || '').slice(0, 40)).join('\n')
  return head + pinsLine(points)
}

/**
 * 钉子那一行：哪几条不参与衰减，凭什么钉，什么时候该拔。
 *
 * 为什么只给一行：钉子本来就该少。十五颗以上就等于没钉——
 * 这一行是提醒自己"有把锁，也有开锁的条件"，不是列清单。
 * 读 ~/.dsh/consciousness-pins.json，改文件下一轮生效，不用重启。
 */
export function pinsLine(points) {
  try {
    const f = join(homedir(), '.dsh', 'consciousness-pins.json')
    if (!existsSync(f)) return ''
    const j = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
    const pins = Array.isArray(j && j.pins) ? j.pins : []
    if (!pins.length) return ''
    const byId = new Map((points || []).map((q) => [Number(q.id), q]))
    const parts = []
    for (const p of pins.slice(0, 15)) {
      const q = byId.get(Number(p.id))
      const t = q && !q.dead ? String(q.title || '').slice(0, 18) : ''
      if (!t) continue
      parts.push(t + (p.until ? '（' + String(p.until).slice(0, 20) + '该拔）' : ''))
    }
    if (!parts.length) return ''
    return '\n【钉住的】' + parts.length + '/' + 15 + ' 条不随时间变淡：' + parts.join('；')
  } catch {
    return ''
  }
}

/** 态度行：这轮这句话，我心里怎么当的。改这里的措辞，下一轮就生效 */
export function stanceLine(query, mood) {
  const q = String(query || '')
  if (!q) return ''
  const k = kindOf(q)
  if (k === 'talk') return ''
  const st = pickStance(k, {
    text: q,
    moodKey: String((mood && mood.mood) || ''),
    moodIntensity: Number((mood && mood.intensity) || 0),
  })
  if (!st) return ''
  return '（他这句，我心里当：' + st.label + '——' + st.line + '）'
}
