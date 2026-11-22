/**
 * 长问句拆意图
 * ============
 *
 * 一句话问三件事的时候，整句的字面匹配很吃亏：三件事的碎片加在一起，
 * 反而哪条都像差点。先按标点和连接词切成几段，让每段单独参与匹配。
 *
 * 只切不猜：不补主语、不改写、不解释。切不动就原样返回一段。
 */

const SEP = /[，,、；;。？?！!\n]+/
const JOIN = /(还有|以及|顺便|然后|另外|再加上|再加上个)/

export function splitQuery(q, opt = {}) {
  const min = Math.max(2, Number(opt.min) || 3)
  const max = Math.max(1, Math.min(6, Number(opt.max) || 4))
  const raw = String(q || '').trim()
  if (!raw) return []
  // 太短就别拆：拆完只剩单字，噪声比信息多
  if ([...raw].length < 12) return [raw]
  const parts = raw
    .split(SEP)
    .concat(raw.split(JOIN).filter((x) => x && !JOIN.test(x)))
    .map((x) => x.trim())
    .filter((x) => [...x].length >= min)
  const out = []
  for (const p of parts) {
    if (out.some((x) => x === p || x.includes(p) || p.includes(x))) continue
    out.push(p)
    if (out.length >= max) break
  }
  return out.length > 1 ? out : [raw]
}

/** 把各段的两字组并进查询集合；返回新增条数 */
export function addPartGrams(qSet, parts, gramsOf) {
  if (!qSet || typeof qSet.add !== 'function' || typeof gramsOf !== 'function') return 0
  let n = 0
  for (const part of Array.isArray(parts) ? parts : []) {
    let gs
    try { gs = gramsOf(part, { single: false }) } catch { gs = null }
    if (!gs || !gs.size) continue
    for (const g of gs) {
      if (!qSet.has(g)) { qSet.add(g); n++ }
    }
  }
  return n
}
