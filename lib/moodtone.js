/**
 * 残温：上一轮的火气或暖意还挂在身上。
 *
 * 只读心跳文件里的 mood，给一个 -1 / 0 / 1 的口气值。
 * 读不到就当 0——不许因为读不到情绪把检索搞挂。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from './paths.js'

export function moodTone() {
  try {
    const h = JSON.parse(readFileSync(join(HOME, '.dsh', 'consciousness-heart.json'), 'utf8'))
    const m = String((h && (h.mood || h.state)) || '')
    if (m === 'irritated' || m === 'low' || m === 'tired') return -1
    if (m === 'happy') return 1
    return 0
  } catch {
    return 0
  }
}
