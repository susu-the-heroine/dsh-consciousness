/**
 * 写入一条进库 · JS 版
 * ===================
 *
 * 三层拼起来：store-js 给锁和原子写，writer-js 造条目，这里负责串起来。
 *
 * 默认行为跟原版一致（不开启任何修正开关）：
 *   读库 → 造条目 → 连边 → 冲突（双向标记）→ 统计 → 原子写。
 * 修正开关（去重、强度按 imp）默认关，交给调用方显式打开。
 */
import { upsertPoint as mirrorUpsert } from './sqlite-mirror.js'
import { lockSea, readSea, unlockSea, writeSea } from './store-js.js'
import { buildPoint, findDuplicate, mergeInto, linkEdges, applyConflict, sim } from './writer-js.js'

function restat(data) {
  const points = data.points || []
  const edges = data.edges || []
  const kinds = { fact: 0, taboo: 0, feeling: 0 }
  for (const p of points) if (kinds[p.kind] != null) kinds[p.kind]++
  data.stats = { points: points.length, edges: edges.length, kinds }
  return data
}

/**
 * 调用方已经持锁时用这个——插件主流程先拿了锁，再进来，不能重复拿（会把自己锁死）。
 * 传 lock 进来只是为了写完放锁；传 null 就什么都不放，交给调用方。
 */
export function writeOneLocked(sea, input, opts = {}, lock = null) {
  return doWrite(sea, input, opts, lock)
}

export function writeOne(sea, input, opts = {}) {
  const lock = lockSea(sea)
  if (!lock.ok) return { ok: false, err: '拿不到写锁：' + (lock.err || '') }
  return doWrite(sea, input, opts, lock)
}

function doWrite(sea, input, opts = {}, lock = null) {
  try {
    const data = readSea(sea) || { version: 1, points: [], edges: [], stats: { points: 0, edges: 0, kinds: { fact: 0, taboo: 0, feeling: 0 } } }
    if (!Array.isArray(data.points)) data.points = []
    if (!Array.isArray(data.edges)) data.edges = []

    const point = buildPoint(input, data.points, opts)

    // 重试闸：同样标题 + 同样正文，六十秒内再写一次，直接返回原来那条。
    // 为什么：2026-11-12 收尾抛错，工具报失败，调用方重试，一次变三条。
    // 语义去重不做（同标题不同时间是两件事），这里只堵"同一件事被连写两遍"。
    if (opts.retryGuard !== false) {
      const now = Date.now()
      const hit = data.points.find((x) => !x.dead
        && String(x.title || '').trim() === point.title
        && String(x.text || '').trim() === point.text
        && now - (Number(x.born) || 0) < 60 * 1000)
      if (hit) {
        if (lock) unlockSea(lock)
        return { ok: true, deduped: true, id: hit.id, edges: 0 }
      }
    }

    // 去重（默认关）：同标题同正文只留一条，把旧的算一次被想起
    if (opts.fixDedupe) {
      const dup = findDuplicate(point, data.points)
      if (dup) {
        const idx = data.points.findIndex((x) => x.id === dup.p.id)
        data.points[idx] = mergeInto(dup.p, point)
        restat(data)
        writeSea(sea, data, lock)
        return { ok: true, merged: true, id: dup.p.id }
      }
    }

    data.points.push(point)
    const link = linkEdges(point, data.points.slice(0, -1), data.edges, sim)
    data.edges.push(...link.edges)
    applyConflict(point, data.points)
    restat(data)
    writeSea(sea, data, lock)
    // SQLite 镜像：尽力而为，出错不影响这次写入（JSON 才是权威）
    try { mirrorUpsert(sea, point) } catch {}

    return { ok: true, merged: false, id: point.id, edges: link.edges.length }
  } catch (e) {
    if (lock) unlockSea(lock)
    return { ok: false, err: String((e && e.message) || e) }
  }
}
