/**
 * 存储层自验：锁、原子写、备份、meta，外加"Python 能不能读 JS 写出来的库"
 *
 * 跑法：node scripts/store-verify.mjs
 * 全程在临时家目录里，不碰真库。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'store-'))
process.env.USERPROFILE = home
process.env.HOME = home

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('✓ ' + name) }
  else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const SEA = join(home, '.dsh', 'consciousness-seas', 'main')
const DATA = join(SEA, 'data.json')

// ── 1. 拿锁 → 写 → 放锁
{
  const lock = S.lockSea('main')
  ok('能拿到锁', lock.ok === true)
  ok('锁文件落在 sea 目录里', existsSync(join(SEA, 'data.json.lock')))
  const data = { version: 1, points: [{ id: 1, title: 't' }], edges: [] }
  S.writeSea('main', data, lock)
  ok('写完锁没了', !existsSync(join(SEA, 'data.json.lock')))
  ok('数据能读回来', S.readSea('main')?.points?.length === 1)
  ok('没有留下 .tmp', !existsSync(DATA + '.tmp'))
}

// ── 2. meta 更新
{
  const metaPath = join(SEA, 'meta.json')
  ok('meta 有 count', existsSync(metaPath) && JSON.parse(readFileSync(metaPath, 'utf8')).count === 1)
}

// ── 3. 备份：第一次写没有旧文件可备，第二次写才该有
{
  const bdir = join(home, '.dsh', 'consciousness-backups', 'main')
  const n0 = existsSync(bdir) ? readdirSync(bdir).length : 0
  ok('第一次写不产生备份（没有旧文件可备）', n0 === 0, '备份数 ' + n0)
  const lock2 = S.lockSea('main')
  S.writeSea('main', { version: 1, points: [{ id: 1, title: 't' }, { id: 2, title: 'u' }], edges: [] }, lock2)
  const n1 = existsSync(bdir) ? readdirSync(bdir).length : 0
  ok('第二次写留了一份备份', n1 === 1, '备份数 ' + n1)
}

// ── 4. 过期锁能抢回来
{
  const path = join(SEA, 'data.json.lock')
  writeFileSync(path, JSON.stringify({ at: Date.now() - 70000, pid: 999999 }), 'utf8')
  const t0 = Date.now()
  const lock = S.lockSea('main')
  const cost = Date.now() - t0
  ok('过期锁能被抢回来', lock.ok === true, '用了 ' + cost + 'ms')
  ok('抢回来不磨蹭（1 秒内）', cost < 1000, cost + 'ms')
  S.unlockSea(lock)
}

// ── 5. 改的时候抛错，锁不能留在盘上
{
  let threw = false
  try {
    S.withSea('main', () => { throw new Error('故意炸') })
  } catch { threw = true }
  ok('改动抛错会往外抛', threw)
  ok('抛错之后锁没留下', !existsSync(join(SEA, 'data.json.lock')))
}

// ── 6. Python 能读 JS 写出来的库
{
  const py = process.env.DSH_TEST_PY
  if (py && existsSync(py)) {
    const r = spawnSync(py, ['-c', `import json,sys;d=json.load(open(r"${DATA}",encoding="utf-8"));print(d["points"][0]["title"])`], { encoding: 'utf8' })
    ok('Python 能读 JS 写的库', (r.stdout || '').trim() === 't', (r.stdout || '') + (r.stderr || '').slice(0, 80))
  } else {
    console.log('- 跳过 Python 互读（没给 DSH_TEST_PY）')
  }
}

rmSync(home, { recursive: true, force: true })
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
