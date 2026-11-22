import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 网页那条写库，不能让人干等两分钟
 * ==============================
 *
 *   node scripts/lock-web-test.mjs
 *
 * 锁被别人占着的时候，网页那条路以前要等 120 秒才报错——人只会以为页面卡死。
 * 现在应该 3 秒内明说"被占着"。锁一放开，又该立刻能写。
 *
 * 全程临时目录。锁里的 pid 用自己（活着），模拟"另一个进程正在写"。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.env.DSH_LOCKWEB === '1') {
  const { homedir } = await import('node:os')
  if (!/c2-lock-/.test(homedir())) {
    console.log(JSON.stringify({ fatal: '没跑在临时目录，拒绝执行' }))
    process.exit(2)
  }
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/'))
  const sea = 'plain'
  const seaDir = join(homedir(), '.dsh', 'consciousness-seas', sea)
  mkdirSync(seaDir, { recursive: true })
  writeFileSync(join(seaDir, 'data.json'), JSON.stringify({ points: [] }), 'utf8')
  const lockPath = join(seaDir, 'data.json.lock')

  // 1) 假装别人正握着锁（pid 用自己的，活着）
  writeFileSync(lockPath, JSON.stringify({ at: Date.now(), pid: process.pid }), 'utf8')
  const t0 = Date.now()
  const blocked = S.lockSea(sea)
  const waited = Date.now() - t0

  // 2) 放开，应该立刻拿到
  rmSync(lockPath, { force: true })
  const t1 = Date.now()
  const got = S.lockSea(sea)
  const gotMs = Date.now() - t1
  // 2026-11-21：解锁要的是拿锁时那个句柄（里面有 path），不是海名。
  // 传海名时 unlockSea 会因为「没有 path」直接返回，锁文件留在原地——实测过：传海名锁还在，传句柄才删掉。
  if (got && got.ok) { try { S.unlockSea(got) } catch {} }
  const lockGone = !existsSync(lockPath)

  console.log(JSON.stringify({
    blockedOk: Boolean(blocked && blocked.ok === false),
    waitedMs: waited,
    gotOk: Boolean(got && got.ok),
    gotMs,
    hasHint: Boolean(blocked && /占|等|稍/.test(String(blocked.err || blocked.log || ''))),
    lockGone,
  }))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-lock-'))
const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_LOCKWEB: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const steps = [
  ['被占着时敢说不', got.blockedOk],
  ['三秒内就说', got.waitedMs >= 2500 && got.waitedMs <= 7000],
  ['说的是人话，不是干等', got.hasHint],
  ['一放开就能写', got.gotOk && got.gotMs <= 200],
  ['写完把锁放回去了', got.lockGone === true],
]
for (const [name, ok] of steps) console.log(`${ok ? '过' : '挂'}  ${name}`)
const allOk = steps.every(([, ok]) => ok)
console.log(allOk ? `锁被占时 ${Math.round(got.waitedMs / 100) / 10} 秒就回话，不让人干等。` : '不对：还是会干等，或者放开也拿不到锁。')
process.exit(allOk ? 0 : 1)
