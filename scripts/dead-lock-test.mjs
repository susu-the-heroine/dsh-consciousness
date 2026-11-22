/**
 * 崩溃留下的锁，不能拖累后面的写入
 * ================================
 *
 *   node scripts/dead-lock-test.mjs [识海]
 *
 * 场景：一个进程写到一半被强杀，`data.json.lock` 留在盘上，里面记的 pid 已经不在了。
 * 要求：下一次写入**立刻**清掉它、照常写，别傻等（等锁一次最长 3 秒；二十次写入就是一分钟）。
 * 2026-11-15 实测发现：不判死主，每个写入都要等满 3 秒。
 */
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'sandbox').trim() || 'sandbox'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const dataPath = join(dir, 'data.json')
const lockPath = join(dir, 'data.json.lock')

if (!existsSync(dataPath)) {
  console.log('没有这个识海：' + sea)
  process.exit(1)
}
if (existsSync(lockPath)) {
  console.log('这个海现在就有锁，先清掉再跑（可能是别的测试留下的）')
  process.exit(1)
}

// 造一个"死进程"的锁：pid 用一个几乎不可能存在的号
const deadPid = 999999
writeFileSync(lockPath, JSON.stringify({ at: Date.now(), pid: deadPid }), 'utf8')

const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))

const t0 = Date.now()
const r = S.writeSea(sea, data)
const ms = Date.now() - t0
const lockGone = !existsSync(lockPath)

console.log(`写入 ${ms}ms · 返回 ${r === false ? 'false' : 'true'} · 死锁被清掉 ${lockGone ? '是' : '不是'}`)
const ok = ms < 1000 && r !== false && lockGone
console.log(ok ? '崩溃留下的锁没拖累写入。' : '不对：死锁没被及时清掉，写入被拖慢了。')
// 第二条路（网页/导入用的 lockSea）也要判死主：不然崩一次，网页那边要白等 60 秒
let ok2 = false
try {
  writeFileSync(lockPath, JSON.stringify({ at: Date.now(), pid: deadPid }), 'utf8')
  const W = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/'))
  const t1 = Date.now()
  const lock = W.lockSea(sea)
  const ms2 = Date.now() - t1
  ok2 = Boolean(lock && lock.ok) && ms2 < 1000
  if (lock && lock.ok) W.unlockSea(lock)
  console.log(`网页那条 lockSea：${ms2}ms · ${ok2 ? '没被死锁拖住' : '被拖住了'}`)
} catch (e) {
  console.log('lockSea 测不了：' + String((e && e.message) || e))
}

try { if (existsSync(lockPath)) unlinkSync(lockPath) } catch {}
process.exit(ok && ok2 ? 0 : 1)
