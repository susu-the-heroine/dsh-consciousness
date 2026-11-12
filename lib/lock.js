/**
 * 写锁
 * ====
 *
 * 同一个识海同时只能有一个写。
 * 进程内锁管不了两个 DSH 窗口，必须落盘。
 * 过期 60 秒——进程被杀留下的锁不会永久卡住。
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { LOCK_TTL, SEAS_DIR } from './paths.js'

export function lockPath(sea) {
  return join(SEAS_DIR, sea, 'data.json.lock')
}

export function acquireWriteLock(sea, retries = 2) {
  const lp = lockPath(sea)
  const now = Date.now()

  for (let i = 0; i <= retries; i++) {
    try {
      // 有锁且没过期 → 等
      if (existsSync(lp)) {
        let info = {}
        try { info = JSON.parse(readFileSync(lp, 'utf8')) } catch {}
        const age = now - (Number(info.at) || 0)
        if (age < LOCK_TTL) {
          if (i < retries) {
            const wait = 200 * (i + 1)
            const t0 = Date.now()
            while (Date.now() - t0 < wait) { /* 忙等，很短 */ }
            continue
          }
          return null
        }
        // 过期了，抢过来
        try { unlinkSync(lp) } catch {}
      }
      // 写锁。目录不存在就建——不然第一次写入必然抛错，
      // 被下面的 catch 吞掉，最后报成"正在被别的窗口写"，骗了自己半天。
      mkdirSync(dirname(lp), { recursive: true })
      writeFileSync(lp, JSON.stringify({ at: now, pid: process.pid }), 'utf8')
      // 再读一次确认是自己的（防竞态）
      let got = {}
      try { got = JSON.parse(readFileSync(lp, 'utf8')) } catch {}
      if (Number(got.pid) === process.pid) {
        return {
          release: () => {
            try {
              const cur = JSON.parse(readFileSync(lp, 'utf8'))
              if (Number(cur.pid) === process.pid) unlinkSync(lp)
            } catch {}
          },
        }
      }
    } catch {}
  }
  return null
}
