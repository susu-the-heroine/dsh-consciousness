import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 绑定表并发测试：两个进程各绑五个窗口，看表里是不是十条
 * ======================================================
 *   node scripts/bind-lock-test.mjs
 *
 * 锁没套上之前，后写的那个拿着读缓存里的旧快照，会把前一个刚绑的盖掉。
 * 退出码 0 = 十条都在，1 = 少了。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const childFile = join(HERE, 'bind-lock-child.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'bind-lock-'))
mkdirSync(join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })

function run(tag) {
  return new Promise((resolve) => {
    const p = spawn(_nodeBin, [childFile, tmp, tag, '5'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: tmp, HOME: tmp } })
    p.on('exit', (code) => resolve(code))
  })
}

const codes = await Promise.all([run('A'), run('B')])
let n = 0
let readFailed = false
try {
  const j = JSON.parse(readFileSync(join(tmp, '.dsh', 'consciousness-bindings.json'), 'utf8'))
  n = Object.keys(j.bySid || {}).length
} catch { readFailed = true }
console.log(`两个进程各绑 5 个窗口，表里实际 ${n} 条（退出码 ${codes.join(',')}）`)
// 2026-11-21：读不出来和「少了」是两回事。原来都印「少了 10 条——锁没起作用」，
// 真遇上文件坏，会把查错方向指到锁上去。分开说。
if (readFailed) console.log('绑定表根本没读出来——这不是丢条，是先查文件本身在不在、能不能解析。')
const ok = n === 10
console.log(ok ? '一条没丢' : (readFailed ? '这条没测到，不算通过' : `少了 ${10 - n} 条——锁没起作用`))
// 2026-11-21：收尾删临时目录在 try 外面，跟「重试闸」那份一个病根——
// 断言全绿、清理一抛就变红（那次实测 EPERM，数据库句柄没放干净）。
try { rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
process.exit(ok ? 0 : 1)
