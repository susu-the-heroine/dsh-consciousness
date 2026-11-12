/**
 * SQLite 镜像自测（直接调模块，不经过插件）
 * ========================================
 *
 * 2026-11-12 的教训：热加载改签名、调用点漏 await，加载没报错、真检索才崩。
 * 所以凡是要接进写入链路的东西，先写自测直接调它。
 *
 * 跑法：node scripts/sqlite-mirror-test.mjs
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'sqm-'))
process.env.USERPROFILE = home
process.env.HOME = home

const M = await import('file:///' + join(HERE, '..', 'lib', 'sqlite-mirror.js').replace(/\\/g, '/') + '?v=' + Date.now())

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  通过  ' + name) }
  else { fail++; console.log('  失败  ' + name + (extra ? ' → ' + extra : '')) }
}

const sea = 't'
const p = {
  id: 1, title: '腰疼', alias: '他腰怎么样', text: '你说腰疼，我让你站起来走两圈。',
  kind: 'feeling', imp: 0.8, arousal: 7, polarity: 0, born: 1793603985388,
  strength: 30, layer: 'core', era: 'ds', category: ['事实'], entities: ['腰'],
  open: true, rule: false,
}

// 1. 写入一条
const r1 = M.upsertPoint(sea, p)
ok('写入成功', r1.ok === true, JSON.stringify(r1))

// 2. 覆盖同一条（改成新正文）
const r2 = M.upsertPoint(sea, { ...p, text: '改过的正文：腰疼就站起来走两圈。' })
ok('覆盖成功', r2.ok === true, JSON.stringify(r2))

// 3. 读回来验证是新的
const { createRequire } = await import('node:module')
const req = createRequire(import.meta.url)
const DB = req('node:sqlite').DatabaseSync
const db = new DB(join(home, '.dsh', 'consciousness-seas', sea, 'memory.db'))
const row = db.prepare('SELECT text, open_flag FROM points WHERE id = 1').get()
ok('正文是覆盖后的', String(row && row.text).includes('改过的正文'))
ok('标记字段没丢', row && row.open_flag === 1)

// 4. 全文索引能搜到（两字词）
const g = M.gramsOf('腰疼').split(' ').filter(Boolean).map((x) => '"' + x + '"').join(' OR ')
const hits = db.prepare('SELECT rowid FROM points_fts WHERE points_fts MATCH ?').all(g)
ok('两字词能搜到', hits.length === 1, 'hit=' + hits.length)

// 5. 关掉镜像时，不该写
process.env.DSH_SQLITE_MIRROR = '0'
const r3 = M.upsertPoint(sea, { ...p, id: 2, title: '第二条' })
ok('开关关掉后跳过', r3.ok === false && r3.skipped === true, JSON.stringify(r3))
process.env.DSH_SQLITE_MIRROR = '1'

// 6. 坏数据不炸（缺字段、null）
let threw = false
try { M.upsertPoint(sea, {}) } catch { threw = true }
ok('坏数据不抛异常', threw === false)

// 7. 关闭句柄不报错
let closeThrew = false
try { M.closeAll() } catch { closeThrew = true }
ok('关闭不报错', closeThrew === false)

try { db.close() } catch {}
rmSync(home, { recursive: true, force: true })
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
