/**
 * 小状态文件的原子写
 * ================
 *
 * 心跳、激素、角色表、稿子记账这些东西，坏一份就丢一段状态。
 * 以前各写各的 `writeFileSync(file, JSON.stringify(x), 'utf8')`，写一半断电就是半截 JSON，
 * 下次读失败还会静默回落成默认值（比如心跳读坏 → 电量变 1、心情变 calm）。
 *
 * 这里只做一件事：先写 <file>.tmp，再 rename 顶替。rename 在同一分区上是原子的。
 * 2026-11-14 审计后加的。
 */
import { writeFileSync, renameSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function writeJsonAtomic(file, obj) {
  try {
    const dir = dirname(file)
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(obj), 'utf8')
    renameSync(tmp, file)
    return true
  } catch {
    // 原子写失败不抛：这些都是一次性状态，不能因为写不进去挡住主流程。
    // 但也别假装成功——调用方要判断就让返回值说话。
    return false
  }
}

/** 读这类小文件；坏文件返回 null，让调用方自己决定要不要回落默认值。 */
export function readJsonSafe(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return fallback
  }
}
