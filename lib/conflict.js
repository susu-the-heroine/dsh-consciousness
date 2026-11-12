/**
 * 冲突检测
 * ========
 *
 * 同一个事实键（factKey）允许并存多个版本——但**必须有人知道它们在打架**。
 * 不报出来，模型会拿着两条矛盾的事实各说一半，那比忘了更糟。
 *
 * 什么算冲突：
 *   同一个 factKey，且**两条都还活着**（validUntil 为空）
 *   ——Python 那边用 validUntil 做版本，正常情况下只会有一条活着。
 *   两条都活着，说明是手工改过或者绕过了版本逻辑。
 *
 * 还有一种不算冲突但要说：**同键里有一条已失效**，注入时只提活的那条就行。
 */
import { readSea } from './store.js'

/** 找同一个事实键下还活着的多版本 */
export function findConflicts(points) {
  const byKey = new Map()
  for (const p of points || []) {
    if (!p || p.dead || p.archived) continue
    const k = String(p.factKey || '').trim()
    if (!k) continue
    if (p.validUntil) continue            // 已失效的版本，不算打架
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(p)
  }
  const out = []
  for (const [key, list] of byKey) {
    if (list.length < 2) continue
    list.sort((a, b) => (Number(b.born) || 0) - (Number(a.born) || 0))
    out.push({ key, items: list })
  }
  return out
}

/**
 * 一句话说清冲突，给注入用。
 * **不许下判断说哪条对**——只说"这里有分歧，问一句"。
 */
export function describeConflict(c) {
  if (!c || !c.items || c.items.length < 2) return ''
  const a = c.items[0]
  const b = c.items[1]
  const t1 = String(a.title || a.text || '').slice(0, 34)
  const t2 = String(b.title || b.text || '').slice(0, 34)
  return '「' + t1 + '」和「' + t2 + '」说的不是一回事，而且都没被作废'
}

/** 一次拿全：给注入调 */
export function conflictsOf(sea) {
  const d = readSea(sea || 'main')
  return findConflicts((d && d.points) || [])
}
