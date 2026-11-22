import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 自模式并发测试：两个进程各记五次「想过」，看计数是不是十
 * ==========================================================
 *   node scripts/mode-lock-test.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const child = join(HERE, 'mode-lock-child.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'mode-lock-'))
mkdirSync(join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })

const run = () => new Promise((resolve) => {
  const p = spawn(_nodeBin, [child, tmp, '5'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: tmp, HOME: tmp } })
  p.on('exit', (c) => resolve(c))
})

const codes = await Promise.all([run(), run()])
let total = 0
// 2026-11-21：读不出来和「丢写」是两回事。原来都印「对不上：期望 100，实际 0」，
// 会把查错方向指到锁上——今晚已经栽过一次「往错的方向查」。
let readFailed = false
try {
  const j = JSON.parse(readFileSync(join(tmp, '.dsh', 'consciousness-selfmode.json'), 'utf8'))
  // thoughtsToday 有上限（3 条），不能用来验丢没丢；tokensToday 不封顶，拿它验。
  total = Number(j.tokensToday || 0)
  if (!total) console.log('文件里没有 think 计数，字段：' + Object.keys(j).join(','))
} catch { readFailed = true }
console.log(`两进程各记 5 次、每次 10 token，累计 ${total} token（退出码 ${codes.join(',')}）`)
if (readFailed) console.log('计数文件根本没读出来——这不是丢写，先查文件本身在不在、能不能解析。')
const ok = total === 100 && !readFailed
console.log(ok ? '一次没丢' : (readFailed ? '这条没测到，不算通过' : `对不上：期望 100 token，实际 ${total}`))
// 2026-11-21：收尾删临时目录挪进 try——跟「重试闸」那份一个病根，
// 那次实测过 EPERM 把绿的盖成红的。
try { rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
process.exit(ok ? 0 : 1)
