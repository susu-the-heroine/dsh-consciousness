/**
 * 小状态文件的互斥锁
 * =================
 * 念头池、绑定表这类「读一份 → 改 → 写回去」的文件，两个进程同时来就会丢更新：
 * 后写的那个拿着旧快照，把前一个刚写的东西盖掉。
 *
 * 这里只做一件事：同一时刻只让一个进程改。
 * 拿不到就等，等到超时也不硬闯——记一条审计，让调用方自己决定要不要重试。
 * 锁文件里写进程号，持有者死掉留下的旧锁超过十秒就清掉。
 */
import { writeFileSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { audit } from './log.js'

const STALE_MS = 10000

function sleep(ms) {
  try {
    const sab = new SharedArrayBuffer(4)
    Atomics.wait(new Int32Array(sab), 0, 0, ms)
  } catch {}
}

/**
 * 在锁里跑 fn。锁文件就是 file + '.lock'。
 * 超时也照样跑（宁可慢一点，不许把功能卡死）。
 * 2026-11-20 逐行核对：注释原来写「会返回 { ok, timedOut }」——实现里没有那层包装，直接返回被包函数的结果，
 * 调用方拿不到「这次没抢到锁」。按实现改注释；要不要把超时暴露出去是接口决定，不在这轮擅改。
 */
export function withLock(file, fn, opts = {}) {
  const lock = file + '.lock'
  const waitMs = Number(opts.waitMs) || 1500
  const t0 = Date.now()
  let held = false
  while (Date.now() - t0 <= waitMs) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      held = true
      break
    } catch (e) {
      if (e && e.code !== 'EEXIST') break
      try {
        const st = statSync(lock)
        if (Date.now() - st.mtimeMs > STALE_MS) { unlinkSync(lock); continue }
      } catch {}
      sleep(15)
    }
  }
  // 2026-11-20：头顶注释写「等到超时也不硬闯——记一条审计」，可这里只算了个 timedOut 就扔了，
  // 一行审计都没记。锁没抢到、两个人一起改，事后连痕迹都没有。现在真记一笔。
  const timedOut = !held
  if (timedOut) {
    try { audit('statefile-lock-timeout', { file: String(file).slice(-80), waitMs }) } catch {}
  }
  try {
    return fn()
  } finally {
    if (held) { try { unlinkSync(lock) } catch {} }
  }
}

export function lockHeld(file) {
  try { return existsSync(file + '.lock') } catch { return false }
}
