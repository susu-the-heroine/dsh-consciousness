/**
 * 自检的两种模式
 * =============
 * instant：她说完立刻推一条"重说"——管用，但看上去像他自己发的，割裂。
 * soft：只记一笔，下一轮开头在注入里提一句——不打断，但慢一拍。
 *
 * 默认 soft。想换类型：~/dsh 的热参数文件里把 instantRetry 调成 1（不用重启）。
 */
import { readLive } from './live.js'

export function retryMode() {
  try {
    const v = Number(readLive().instantRetry) || 0
    return v > 0 ? 'instant' : 'soft'
  } catch { return 'soft' }
}
