/**
 * 跑 Python
 * =========
 *
 * 写入、重排、迁移这些活儿都在 add_memory.py 里做。
 * 这里是唯一的调用口：找 Python，跑脚本，把 stdout 原样带回来。
 *
 * 找不到 Python 的时候要说人话——不是抛 ENONET，
 * 是「装个 Python 再重启 DSH，页面能看但写不了记忆」。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { PY_CANDIDATES, SCRIPT } from './paths.js'

/** 找一个能用的 Python。都找不到就返回 'python'，让系统 PATH 去试 */
export function pickPython() {
  for (const p of PY_CANDIDATES) {
    if (p === 'python') return p
    try {
      if (existsSync(p)) return p
    } catch {
      /* 忽略 */
    }
  }
  return 'python'
}

/** 跑一次 add_memory.py，把 stdout 原样带回来 */
export function run(args, timeoutMs = 90000) {
  return new Promise((done, fail) => {
    execFile(
      pickPython(),
      [SCRIPT, ...args],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim()
        const errText = String(stderr || '').trim()
        if (err && !out) {
          const raw = errText || err.message || '执行失败'
          if (/ENOENT|not recognized|不是内部或外部命令|No such file/i.test(raw)) {
            return fail(
              new Error('没找到 Python。装一个 Python 3.9+ 再重启 DSH —— 页面能看，但写不了记忆。'),
            )
          }
          return fail(new Error(raw.slice(-600)))
        }
        done(out || errText)
      },
    )
  })
}
