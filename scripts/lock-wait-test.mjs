import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 锁被占住的时候，两条路各自什么反应
 * ==================================
 *
 *   node scripts/lock-wait-test.mjs [识海]
 *
 * 现在两种语义并存（这是有意的，等白天统一）：
 *   · store.js（主链路五十四处）：最多等 3 秒；还拿不到就不写（返回 false），并记一条 write-lock-timeout。
 *     2026-11-21 更正：这里原来写「等 0.8 秒、拿不到就照写」——那是 11-15 之前的老规矩，
 *     后来改成等 3 秒（实测 3025 毫秒）、并且不再照写（照写会盖掉别人正在写的库）。
 *   · store-js.js（网页与导入）：拿不到就拒写、报错。
 *
 * 这个测试把"当前行为"钉住。哪天统一了语义，它会红——那正是提醒你改文档和这条测试。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const sea = (process.argv[2] || 'sandbox').trim() || 'sandbox'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const dataPath = join(dir, 'data.json')
// 2026-11-21：这个路径以前在下面才声明，上面第 44 行就想用它清残留锁——
// 一用就是「还没初始化」，而那句外面包着 catch，于是清锁从来没跑过，还一声不响。
const lockPath = join(dir, 'data.json.lock')

if (!existsSync(dataPath)) {
  console.log(`没有这个识海：${sea}`)
  process.exit(1)
}

if (process.env.DSH_LOCK_HOLD === '1') {
  // 子进程：占住锁 2 秒
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/'))
  const lock = S.lockSea(sea)
  if (!lock || !lock.ok) { console.log('holder-fail'); process.exit(1) }
  console.log('held')
  // 占锁比 store.js 的等待更久（它等 3 秒），这样它必然等不到、走照写那条分支
  await new Promise((r) => setTimeout(r, 6000))
  S.unlockSea(lock)
  process.exit(0)
}

// 必须让子进程"活着"占锁：spawnSync 会等它跑完，锁早就放了（第一版就栽在这）
// 测试开始前先清掉可能残留的锁：这个海是测试专用的，不会有正经进程在写它
try { if (existsSync(lockPath)) unlinkSync(lockPath) } catch {}

const holder = spawn(_nodeBin, [SELF, sea], {
  env: { ...process.env, DSH_LOCK_HOLD: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let heldLine = ''
holder.stdout.on('data', (b) => { heldLine += String(b) })
const started = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(heldLine.includes('held')), 5000)
  holder.stdout.on('data', () => { if (heldLine.includes('held')) { clearTimeout(t); resolve(true) } })
  holder.on('exit', () => { clearTimeout(t); resolve(heldLine.includes('held')) })
})
if (!started) {
  console.log('占锁的子进程没起来')
  try { holder.kill() } catch {}
  process.exit(1)
}

const raw = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
const snapshot = JSON.parse(JSON.stringify(raw))

const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))

// 1) 主链路：该等满 3 秒，然后不写（返回 false），不是照写
const t0 = Date.now()
const r1 = S.writeSea(sea, snapshot)
const ms = Date.now() - t0
// 2026-11-19 改契约：拿不到锁不再「照写」，直接不写（返回 false）。
// 以前的照写会把别人正在写的库盖掉——故障注入验出来的。
const mainWrote = r1 !== false
const waited = ms >= 2500

// 2) 主链路照写之后，**不许把别人的锁删掉**。
//    （第一版这里写成"网页那条该拒写"，是错的：lockSea 会等，等到了自然能拿，不是拒。）
const lockStillThere = existsSync(lockPath)

// 3) 审计里有没有留下超时记录
let auditHit = false
try {
  const log = readFileSync(join(homedir(), '.dsh', 'consciousness-audit.log'), 'utf8')
  auditHit = /write-lock-timeout|write-sea-lock-refused/.test(log.slice(-4000))
} catch {}

console.log(`主链路：${mainWrote ? '照写' : '没写'} · 等了 ${ms}ms（${waited ? '确实等过' : '没等'}）`)
console.log(`别人的锁：${lockStillThere ? '还在（没被删）' : '被删了'}`)
console.log(`审计留痕：${auditHit ? '有' : '没看到'}`)

// 收尾：把占锁子进程杀掉，并清掉它可能留下的锁文件——
// 不清的话，后面的测试（死锁那条）会被这把锁挡在门口。2026-11-15
try { holder.kill() } catch {}
try { unlinkSync(lockPath) } catch {}

const ok = !mainWrote && waited && lockStillThere && auditHit

console.log(ok ? '锁被占时的行为，跟文档写的一致。' : '行为跟文档不一致了，先对一下再改。')
process.exit(ok ? 0 : 1)
