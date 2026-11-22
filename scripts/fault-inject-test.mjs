/**
 * 故障注入：锁被占、写不进去
 * ========================
 *   node scripts/fault-inject-test.mjs
 *
 * 验三件：
 *   1. 锁被一个活人占着：写入不许硬写，要在几秒内认输，并留下审计
 *   2. 目录被占/不可写：写入报错，但进程不许崩
 *   3. 上面两轮过后，原库还完好：能解析、条数不变
 *
 * 全在临时库里做，不碰真库。
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL_HOME = homedir()
const SRC = join(REAL_HOME, '.dsh', 'consciousness-seas', 'main')
if (!existsSync(SRC)) { console.error('找不到 main 海：' + SRC); process.exit(2) }

const tmp = mkdtempSync(join(tmpdir(), 'fault-'))
const seas = join(tmp, '.dsh', 'consciousness-seas')
mkdirSync(seas, { recursive: true })
cpSync(SRC, join(seas, 'main'), { recursive: true })
process.env.USERPROFILE = tmp
process.env.HOME = tmp

const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/') + '?v=' + Date.now())

const seaDir = join(seas, 'main')
const dataPath = join(seaDir, 'data.json')
const before = readFileSync(dataPath, 'utf8')
const nBefore = (JSON.parse(before).points || []).length

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

// 一、锁被活人占着
let t0 = Date.now()
let threw = ''
let ret = null
try {
  // 用一个「别的、还活着的进程」的 pid：Windows 上 4 是 System，process.kill(4,0) 成功。
  // 别用自己进程的 pid——那会被当成上次留下的自锁收掉（2026-11-19）。
  writeFileSync(join(seaDir, 'data.json.lock'), JSON.stringify({ at: Date.now(), pid: 4 }), 'utf8')
  const data = JSON.parse(before)
  data.points.push({ id: 990001, title: '注入测试：锁住的时候不该写进来', text: '这条是为了验证锁被占着时写入会认输。', kind: 'fact', imp: 0.5 })
  try { ret = S.writeSea('main', data) } catch (e) { threw = String((e && e.message) || e) }
} finally {
  try { rmSync(join(seaDir, 'data.json.lock'), { force: true }) } catch {}
}
const lockMs = Date.now() - t0
ok('锁被占：没有硬写', threw !== '' || ret === false || ret === null, 'threw=' + threw + ' ret=' + String(ret))
ok('锁被占：几秒内认输（<8s）', lockMs < 8000, lockMs + 'ms')

// 二、目录被占：把海目录换成一个同名文件
let threw2 = ''
let ret2 = null
try {
  const bak = join(seas, 'main-bak')
  renameSync(seaDir, bak)
  writeFileSync(seaDir, 'not a dir', 'utf8')
  try {
    ret2 = S.writeSea('main', { version: 1, points: [{ id: 990002, title: 'x', text: 'y' }] })
    threw2 = ''
  } catch (e) { threw2 = String((e && e.message) || e) }
  rmSync(seaDir, { force: true })
  renameSync(bak, seaDir)
} catch (e) {
  threw2 = threw2 || 'setup:' + String((e && e.message) || e)
  try {
    if (existsSync(join(seas, 'main-bak')) && !existsSync(seaDir)) renameSync(join(seas, 'main-bak'), seaDir)
  } catch {}
}
// 2026-11-21：这两条以前把 true 写死，等于永远绿——抓到的错只被当成附注打印。
// 现在的判据：要么抛错、要么明确返回 false，不许「什么都没发生还说写成了」。
ok('目录被占：写入报错或明确拒绝，不是当没看见', threw2 !== '' || ret2 === false, 'threw=' + threw2 + ' ret=' + String(ret2))
ok('目录被占：进程还活着', true)  // 能走到这一行本身就是证据

// 三、原库完好
let nAfter = -1
let parseOk = false
try {
  const after = JSON.parse(readFileSync(dataPath, 'utf8'))
  nAfter = (after.points || []).length
  parseOk = true
} catch {}
ok('库里还能解析', parseOk)
ok('条数没变', nAfter === nBefore, nBefore + ' → ' + nAfter)
ok('没留半截临时文件', !existsSync(dataPath + '.tmp'))

console.log(`\n故障注入：通过 ${pass} · 失败 ${fail}`)
try { rmSync(tmp, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
