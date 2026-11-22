/**
 * 实体归一（2026-11-16，清单第 16 件）
 * ------------------------------------------------------------
 * 关掉模糊匹配，只信两样：
 *   L0 归一化后完全相等 → 自动并成一个；
 *   L1 人工别名表       → 自动并成一个；
 *   其余只出候选，绝不自动并。
 *
 * 为什么：实测 197 个实体面里 72% 只出现一次；「苏苏侠」和「大魔王」
 * 是同一个人、提了 83 次，字符串相似度却是 0；字符/编辑距离规则
 * 跑出的 7 对候选，0 对正确——模糊并就是把两件不相干的事焊死。
 *
 * 写侧不动：写入只连边不合并；检索侧拿这张表把别名展开再找。
 * 别名表默认空——别人的库不自动乱并；想并哪对，使用者在识海里
 * 写 entityAliases: [{ canon: '苏苏侠', aliases: ['大魔王'] }]。
 */

/** 归一化：全角转半角、去首尾标点、折叠空格、小写。 */
export function normalizeEntity (name) {
  return String(name || '')
    .trim()
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/^[\s"'“”「」『』()（）【】[\]:：,，.。、]+|[\s"'“”「」『』()（）【】[\]:：,，.。、]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * 从活着条目里数实体面，选出每个面的正身，再按人工别名表并组。
 * 返回 Map：norm -> { canon, members:Set(norm), spellings:Set(原始拼法) }
 */
export function buildCanon (points, extraAliases) {
  const aliases = Array.isArray(extraAliases) ? extraAliases : []
  const freq = new Map() // norm -> Map(拼法 -> 出现条数)
  for (const p of points || []) {
    if (p.dead || p.archived) continue
    const ents = Array.isArray(p.entities) ? p.entities : (p.entity ? [p.entity] : [])
    for (const e of ents) {
      const raw = String(e || '').trim()
      if (!raw) continue
      const norm = normalizeEntity(raw)
      if (!norm) continue
      if (!freq.has(norm)) freq.set(norm, new Map())
      const m = freq.get(norm)
      m.set(raw, (m.get(raw) || 0) + 1)
    }
  }

  // 每个面选正身：出现最多的拼法，平手取最长的
  const faces = new Map() // norm -> { name, spellings }
  for (const [norm, spellings] of freq) {
    let best = null
    let bestN = -1
    for (const [sp, n] of spellings) {
      if (n > bestN || (n === bestN && (!best || sp.length > best.length))) { best = sp; bestN = n }
    }
    faces.set(norm, { name: best, spellings })
  }

  // 别名表并组（union-find，只并两边都真实存在的面——不存在的别名不造实体）
  const parent = new Map()
  const find = (x) => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)
    return r
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const pair of aliases) {
    const c = normalizeEntity(pair && pair.canon)
    if (!c || !faces.has(c)) continue
    const list = Array.isArray(pair && pair.aliases) ? pair.aliases : []
    for (const a of list) {
      const an = normalizeEntity(a)
      if (an && faces.has(an)) union(c, an)
    }
  }

  // 组装组，选组名（正身取组内出现最多的那个面）
  const groups = new Map() // root -> { members:Set(norm) }
  for (const norm of faces.keys()) {
    const root = find(norm)
    if (!groups.has(root)) groups.set(root, { members: new Set() })
    groups.get(root).members.add(norm)
  }
  const out = new Map()
  for (const g of groups.values()) {
    let bestName = null
    let bestTot = -1
    const allSpellings = new Set()
    for (const m of g.members) {
      const face = faces.get(m)
      let tot = 0
      for (const n of face.spellings.values()) tot += n
      for (const sp of face.spellings.keys()) allSpellings.add(sp)
      if (tot > bestTot) { bestTot = tot; bestName = face.name }
    }
    for (const m of g.members) {
      out.set(m, { canon: bestName, members: g.members, spellings: allSpellings })
    }
  }
  return out
}

/** 提到一个名字，把它这一组的所有写法都展开出来。 */
export function expandEntity (name, canonInfo) {
  const out = new Set()
  const raw = String(name || '').trim()
  if (!raw) return out
  out.add(raw)
  const norm = normalizeEntity(raw)
  const hit = canonInfo && canonInfo.get(norm)
  if (!hit) return out
  for (const sp of hit.spellings) out.add(sp)
  return out
}
