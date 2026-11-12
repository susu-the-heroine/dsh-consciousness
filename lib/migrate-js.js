/**
 * 迁移与批量导入 · JS 版
 * ======================
 *
 * 原来这些活只有 Python 有（backfill.py / migrate_v3.py）。现在补一份 JS 的：
 *
 *   backfill(sea)   给旧条目补缺的字段（别名、实体、分类、情绪、钉子、层）
 *   importPoints()  把外部 JSON 里的条目批量灌进某个海（可选去重）
 *
 * 原则：
 *   1. 只填空，不覆盖已有值——已经有数的地方一个字不动。
 *   2. 干跑优先：默认只报告"会补什么"，加 apply 才真写。
 *   3. 走锁 + 原子写，跟正常写入同一条路。
 */
import { lockSea, readSea, writeSea, unlockSea } from './store-js.js'
import { buildPoint, extractEntities, extractTriggers } from './writer-js.js'

const EMO_KEYS = ['anger', 'grievance', 'shame', 'anxiety', 'excitement', 'tenderness', 'fatigue', 'numbness']

// 空数组也算"有这个字段"——不然补了 [] 下次还判缺，永远不幂等（2026-11-12 踩到）
function has(o, k) {
  return !!o && o[k] !== undefined && o[k] !== null
}

/** 一条条目缺什么。返回要补的字段名数组，顺便给出补上的值。 */
export function missingOf(p) {
  const fill = {}
  const miss = []

  if (!has(p, 'titleFull') && p.title) { fill.titleFull = String(p.title); miss.push('titleFull') }
  if (!has(p, 'tag')) { fill.tag = p.kind === 'taboo' ? '〔实·禁〕' : p.kind === 'setting' ? '〔设〕' : p.kind === 'feeling' ? '〔情〕' : '〔实〕'; miss.push('tag') }
  if (!has(p, 'era')) { fill.era = 'ds'; miss.push('era') }
  if (!has(p, 'entities')) {
    fill.entities = extractEntities(String(p.text || '') + ' ' + String(p.title || ''))
    miss.push('entities')
  }
  if (!has(p, 'triggers')) {
    fill.triggers = extractTriggers(String(p.text || '') + ' ' + String(p.title || ''), p.id)
    miss.push('triggers')
  }
  if (!has(p, 'emotion')) {
    // 用一次性的构建器算一遍情绪，只取情绪字段；其它字段不回填，免得改动历史值
    const probe = buildPoint({ title: p.title, text: p.text, kind: p.kind, polarity: p.polarity, arousal: p.arousal }, [])
    if (probe && probe.emotion && Object.values(probe.emotion).some((v) => v > 0)) {
      fill.emotion = probe.emotion
      miss.push('emotion')
    }
  }
  if (!has(p, 'confidence')) { fill.confidence = 0.85; miss.push('confidence') }
  if (!has(p, 'polarity')) { fill.polarity = 0; miss.push('polarity') }
  if (!has(p, 'arousal')) { fill.arousal = 5; miss.push('arousal') }
  if (!has(p, 'imp')) { fill.imp = 0.6; miss.push('imp') }
  if (!has(p, 'recallCount')) { fill.recallCount = 0; miss.push('recallCount') }
  if (!has(p, 'origin')) { fill.origin = 'import'; miss.push('origin') }
  if (!has(p, 'validFrom')) { fill.validFrom = Number(p.born) || Date.now(); miss.push('validFrom') }
  if (!has(p, 'conflictWith')) { fill.conflictWith = []; miss.push('conflictWith') }
  if (!has(p, 'evidence') && p.text) { fill.evidence = String(p.text).slice(0, 400); miss.push('evidence') }

  return { miss, fill }
}

/** 统计一个海缺什么（干跑用）。 */
export function scan(sea) {
  const data = readSea(sea)
  if (!data) return { ok: false, err: '没有这个海' }
  const stat = new Map()
  let dirty = 0
  for (const p of data.points || []) {
    const { miss } = missingOf(p)
    if (miss.length) dirty++
    for (const k of miss) stat.set(k, (stat.get(k) || 0) + 1)
  }
  return { ok: true, total: (data.points || []).length, dirty, stat: Object.fromEntries(stat) }
}

/**
 * 补字段。apply=false 只报告。
 * 只补缺失的键，已有值一律不覆盖——这是这份脚本最容易出人命的地方，写死在这里。
 */
export function backfill(sea, { apply = false } = {}) {
  const lock = lockSea(sea)
  if (!lock.ok) return { ok: false, err: '拿不到写锁：' + (lock.err || '') }
  try {
    const data = readSea(sea) || { version: 1, points: [], edges: [] }
    let changed = 0
    const stat = new Map()
    for (const p of data.points || []) {
      const { miss, fill } = missingOf(p)
      if (!miss.length) continue
      changed++
      for (const k of miss) stat.set(k, (stat.get(k) || 0) + 1)
      if (apply) for (const [k, v] of Object.entries(fill)) if (!has(p, k)) p[k] = v
    }
    if (apply && changed) writeSea(sea, data, lock)
    else unlockSea(lock)
    return { ok: true, total: (data.points || []).length, changed, applied: apply, stat: Object.fromEntries(stat) }
  } catch (e) {
    unlockSea(lock)
    return { ok: false, err: String((e && e.message) || e) }
  }
}

/**
 * 批量导入：把外部条目灌进某个海。
 * 每条都过一遍 buildPoint，所以字段跟正常写入一致；默认按"同标题同正文"去重。
 */
export function importPoints(sea, list, { dedupe = true, apply = false } = {}) {
  const lock = lockSea(sea)
  if (!lock.ok) return { ok: false, err: '拿不到写锁：' + (lock.err || '') }
  try {
    const data = readSea(sea) || { version: 1, points: [], edges: [] }
    if (!Array.isArray(data.points)) data.points = []
    if (!Array.isArray(data.edges)) data.edges = []

    const seen = new Set(
      data.points.map((p) => String(p.title || '').trim() + '\u0000' + String(p.text || '').trim()),
    )
    let added = 0
    let skipped = 0
    for (const raw of list) {
      const key = String(raw.title || '').trim() + '\u0000' + String(raw.text || '').trim()
      if (!key.trim()) { skipped++; continue }
      if (dedupe && seen.has(key)) { skipped++; continue }
      seen.add(key)
      const point = buildPoint(raw, data.points)
      if (apply) data.points.push(point)
      added++
    }
    if (apply && added) {
      const kinds = { fact: 0, taboo: 0, feeling: 0 }
      for (const p of data.points) if (kinds[p.kind] != null) kinds[p.kind]++
      data.stats = { points: data.points.length, edges: data.edges.length, kinds }
      writeSea(sea, data, lock)
    } else {
      unlockSea(lock)
    }
    return { ok: true, added, skipped, applied: apply, total: data.points.length }
  } catch (e) {
    unlockSea(lock)
    return { ok: false, err: String((e && e.message) || e) }
  }
}

export { EMO_KEYS }
