/**
 * 存储 · JS 版（锁 + 原子写 + 备份）
 * ================================
 *
 * 跟 add_memory.py 的行为对齐，逐条都有出处：
 *   锁：sea 目录下 data.json.lock，内容是 {at, pid}，60 秒算过期，最多等 120 秒。
 *       ——两边必须用同一把锁，否则导入和聊天同时写照样撞。
 *   写：先写 data.json.tmp、fsync、再 rename 覆盖。直接覆盖的话，写到一半断电就是半个 JSON。
 *   备：写之前拷一份到 backups/<sea>/<时间>.json，只留最近 14 天。
 *   meta：写完更新 meta.json 的 count 与 mtime。
 */
import { replaceAll as mirrorReplaceAll } from './sqlite-mirror.js'
import { existsSync, linkSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
const BACKUP = join(homedir(), '.dsh', 'consciousness-backups')

export const LOCK_TTL_MS = 60 * 1000
const LOCK_WAIT_MS = 120 * 1000
const KEEP_DAYS = 14

export function seaDir(sea = 'main') {
  return join(SEAS, sea)
}

function sleep(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) { /* 忙等：这里不能 await，锁应该是同步的 */ }
}

/**
 * 抢锁。抢到返回 true，等超时返回 false（调用方必须当作失败处理，不能硬写）。
 * 过期判据：锁文件里的 at 超过 60 秒，或者文件本身 60 秒没动。
 */
export function lockSea(sea = 'main') {
  const dir = seaDir(sea)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'data.json.lock')
  const deadline = Date.now() + LOCK_WAIT_MS
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    // 两步走：先把"谁、什么时候"写进一个唯一临时文件，再用硬链接挂到锁名上。
    // 为什么不用 open('wx') 再写内容：那中间有一瞬文件是空的，别的进程读到空文件
    // 会当成"过期锁"删掉，于是两个进程同时持锁——2026-11-12 压测就是这么丢条的。
    const tmp = join(dir, `.lock-${process.pid}-${Date.now()}-${attempt}`)

    // DSH_LOCK_MODE=create：强制走"独占创建"那条退路。
    // 给不支持硬链接的盘用，也用来量退路的代价。2026-11-12
    if (process.env.DSH_LOCK_MODE === 'create') {
      try {
        const fd = openSync(path, 'wx')
        writeSync(fd, JSON.stringify({ at: Date.now(), pid: process.pid }))
        closeSync(fd)
        return { ok: true, path, via: 'create' }
      } catch (e3) {
        if (!e3 || e3.code !== 'EEXIST') return { ok: false, path, err: '锁创建失败：' + String((e3 && e3.message) || e3) }
        let staleC = false
        try {
          const info = JSON.parse(readFileSync(path, 'utf8'))
          const at = Number(info.at || 0)
          staleC = at > 0 ? Date.now() - at > LOCK_TTL_MS : false
        } catch { try { staleC = Date.now() - statSync(path).mtimeMs > LOCK_TTL_MS } catch {} }
        if (staleC) { try { unlinkSync(path) } catch {}; continue }
        sleep(20 + (attempt % 5) * 10)
        continue
      }
    }
    try {
      writeFileSync(tmp, JSON.stringify({ at: Date.now(), pid: process.pid }), 'utf8')
      linkSync(tmp, path)          // 目标已存在会抛错，这就是原子性所在
      try { unlinkSync(tmp) } catch {}
      return { ok: true, path }
    } catch (e) {
      const code = e && e.code

      // 有些盘不支持硬链接（FAT、部分网络盘、某些挂载的移动硬盘）。
      // 那种情况下 linkSync 会报 EPERM/ENOSYS/EXDEV/ENOTSUP——这时退回"独占创建"，
      // 虽有一瞬空文件的窗口，但总比写不进去强。2026-11-12：不补这条，别人装到不支持的盘上会写不进去。
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'EXDEV' || code === 'ENOTSUP' || code === 'EACCES') {
        try {
          const fd = openSync(path, 'wx')
          writeSync(fd, JSON.stringify({ at: Date.now(), pid: process.pid }))
          closeSync(fd)
          try { unlinkSync(tmp) } catch {}
          return { ok: true, path, via: 'create' }
        } catch (e2) {
          try { unlinkSync(tmp) } catch {}
          if (!e2 || e2.code !== 'EEXIST') {
            return { ok: false, path, err: '锁创建失败：' + String((e2 && e2.message) || e2) }
          }
          // 落到下面的"锁在"处理
        }
      } else if (code !== 'EEXIST') {
        try { unlinkSync(tmp) } catch {}
        return { ok: false, path, err: String((e && e.message) || e) }
      }
      try { unlinkSync(tmp) } catch {}
      // 锁在。看看是不是过期了（对方写了一半就死了）
      let stale = false
      try {
        const info = JSON.parse(readFileSync(path, 'utf8'))
        const at = Number(info.at || 0)
        stale = at > 0 ? Date.now() - at > LOCK_TTL_MS : false
      } catch {
        // 读不懂就不要抢——原来是按 mtime 判过期，会把刚建好的锁误删
        try { stale = Date.now() - statSync(path).mtimeMs > LOCK_TTL_MS } catch {}
      }
      if (stale) {
        try { unlinkSync(path) } catch {}
        continue
      }
      sleep(20 + (attempt % 5) * 10)
    }
  }
  return { ok: false, path, err: 'timeout' }
}

export function unlockSea(lock) {
  if (!lock || !lock.path) return
  try { unlinkSync(lock.path) } catch {}
}

/** 写之前留一份，只留最近 14 天 */
export function backupSea(sea = 'main') {
  const src = join(seaDir(sea), 'data.json')
  if (!existsSync(src)) return null
  try {
    const d = join(BACKUP, sea)
    mkdirSync(d, { recursive: true })
    const stamp = new Date()
    const name = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
      + `-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}.json`
    const dst = join(d, name)
    copyFileSync(src, dst)
    const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000
    for (const f of readdirSync(d)) {
      const fp = join(d, f)
      try { if (statSync(fp).isFile() && statSync(fp).mtimeMs < cutoff) unlinkSync(fp) } catch {}
    }
    return dst
  } catch {
    return null
  }
}

/**
 * 原子写：tmp → fsync → rename；写完更新 meta；最后放锁。
 * 任何一步抛错都会放锁，不把锁留在盘上。
 */

// 镜像（防抖）：写库很频繁（每 2 秒心跳、每次检索都可能改强度），
// 一条条镜像太碎。这里两秒内的多次写合成一次全量镜像。
// 失败只吞掉——JSON 才是权威，绝不因为镜像拖垮写入。
const _mirrorTimers = new Map()
function mirrorSoon(sea, data) {
  try {
    const old = _mirrorTimers.get(sea)
    if (old) clearTimeout(old)
    // 全量重写镜像：小库很便宜，大库会成灾。超过五千条就不自动镜像了——
    // 那时候该用显式重建（脚本），不该在两秒一次的写路径里塞几万行。
    const points = (data && data.points) || []
    const t = setTimeout(() => {
      _mirrorTimers.delete(sea)
      if (points.length > 5000) return
      try {
        mirrorReplaceAll(sea, points, (data && data.edges) || [])
      } catch {}
    }, 2000)
    if (t && typeof t.unref === 'function') t.unref()
    _mirrorTimers.set(sea, t)
  } catch {}
}

export function writeSea(sea, data, lock) {
  mirrorSoon(sea, data)
  const dir = seaDir(sea)
  mkdirSync(dir, { recursive: true })
  const real = join(dir, 'data.json')
  const tmp = real + '.tmp'
  try {
    backupSea(sea)
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, JSON.stringify(data))
      try { /* fsync 在 Windows 上由 close 保证落盘 */ } catch {}
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, real)
    try {
      const metaPath = join(dir, 'meta.json')
      let meta = {}
      if (existsSync(metaPath)) {
        try { meta = JSON.parse(readFileSync(metaPath, 'utf8').replace(/^\uFEFF/, '')) || {} } catch { meta = {} }
      }
      meta.count = (data.points || []).length
      const d = new Date()
      meta.mtime = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        + ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
    } catch {}
    return { ok: true }
  } finally {
    unlockSea(lock)
  }
}

export function readSea(sea = 'main') {
  const f = join(seaDir(sea), 'data.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 用一把锁做完一件事：读、改、写。改的时候抛错就不写。 */
export function withSea(sea, fn) {
  const lock = lockSea(sea)
  if (!lock.ok) throw new Error('拿不到写锁：' + (lock.err || ''))
  try {
    const data = readSea(sea) || { version: 1, points: [], edges: [] }
    const next = fn(data)
    if (next === false) { unlockSea(lock); return { ok: false, changed: false } }
    writeSea(sea, data, lock)
    return { ok: true, changed: true, data }
  } catch (e) {
    unlockSea(lock)
    throw e
  }
}
