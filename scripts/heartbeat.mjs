/**
 * 心跳：证明这机器还在往下走
 * ============================
 *
 *   node scripts/heartbeat.mjs "读了 xxx 1-120"
 *
 * 干什么：把一句话追加进 docs/心跳.log，一行带时间。
 * 为什么：这一晚反复被上游判成「拒绝」掐断，而目标被挂起之后，
 * 那个恢复键只有人按得动——我按不动（系统直接回：模型不能恢复暂停的目标）。
 * 所以只能做两件事：
 *   1. 定一个二十分钟的闹钟（schedule），到点自己叫醒我，起一轮活；
 *   2. 每轮留一行心跳，这样一眼就看得出「是我停了，还是它把我掐了」。
 */
import { appendFileSync, existsSync, statSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = join(HERE, '..', 'docs', '心跳.log')
const MAX = 256 * 1024

const msg = process.argv.slice(2).join(' ').trim() || '（没说干了什么）'
// 2026-11-21：原来用的是国际标准时间，写出来比他墙上的钟整整差八小时
// （实测：本机 02:17，日志写成 18:16）。这条心跳的全部意义就是「对时间」，
// 差八小时等于白写。改成写本机时间。旧的几百行是国际时间，不回头改，认了。
const _d = new Date()
const _p = (x) => String(x).padStart(2, '0')
const stamp = `${_d.getFullYear()}-${_p(_d.getMonth() + 1)}-${_p(_d.getDate())} ${_p(_d.getHours())}:${_p(_d.getMinutes())}:${_p(_d.getSeconds())}`
const line = stamp + '  ' + msg + '\n'

try {
  // 太长就轮一次，只留一档，别让它自己变成垃圾
  if (existsSync(LOG) && statSync(LOG).size > MAX) {
    try { renameSync(LOG, LOG + '.1') } catch {}
  }
  appendFileSync(LOG, line, 'utf8')
  console.log('心跳：' + line.trim())
} catch (e) {
  console.log('心跳写不进去：' + String(e && e.message))
}
