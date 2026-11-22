/**
 * 第一个小时：空手装上，能不能自己把事办成
 * ======================================
 *
 *   node scripts/first-hour-test.mjs
 *
 * 模拟一个陌生人：刚从没装过的地方开始，家目录空的。
 * 按真人顺序走一遍，每一步都断言"能继续"：
 *   1. 空着读：不抛错
 *   2. 写第一条：自动建海、建目录
 *   3. 列海：能看到刚建的那个
 *   4. 检索：刚写的那条搜得回来
 *   5. 再写一条：不覆盖前一条
 *   6. 导一份文本：能看到两条
 *
 * 全程临时家目录，真库不碰。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.env.DSH_FIRST_HOUR === '1') {
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
  const SEAS = await import('file:///' + join(HERE, '..', 'lib', 'seas.js').replace(/\\/g, '/'))
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
  const M = await import('file:///' + join(HERE, '..', 'lib', 'mirror-export.js').replace(/\\/g, '/'))
  const out = {}

  // 1 空着读
  let threw = null
  try { S.readSea('main') } catch (e) { threw = String((e && e.message) || e) }
  out.emptyReadOk = threw === null

  // 2 写第一条（自己建海）
  const t = Date.now()
  const one = { points: [{ id: 1, title: '第一件事', text: '今天开始用这个东西，先写一条试试。', bornAt: t, at: t }] }
  out.firstWrite = S.writeSea('main', one) !== false
  out.seaCreated = existsSync(join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'data.json'))

  // 3 列海
  let list = []
  try { list = SEAS.listSeas() } catch (e) { list = [] }
  out.listDebug = (Array.isArray(list) ? list : []).map((x) => (x && x.id) || String(x)).slice(0, 5)
  out.seaListed = Array.isArray(list) && list.some((x) => String((x && (x.id || x.name)) || x) === 'main')

  // 4 搜得回来
  // 走真正给人用的那条检索（工具入口），不是底层候选函数——
  // 候选函数在库很小时会故意返回空、让上层整库扫，直接拿它断言会误判。
  let sr = null
  try { sr = await T.searchTool.execute({ sea: 'main', query: '先写一条试试' }) } catch (e) { sr = { ok: false, err: String((e && e.message) || e) } }
  out.searchDebug = JSON.stringify(sr).slice(0, 160)
  out.searchHits = Boolean(sr && sr.ok !== false && (String(sr.log || '').includes('第一件事') || String(sr.log || '').includes('先写一条')))

  // 5 再写一条，不覆盖
  const two = { points: [...one.points, { id: 2, title: '第二件事', text: '第二天又写了一条。', bornAt: t + 1, at: t + 1 }] }
  out.secondWrite = S.writeSea('main', two) !== false
  const back = S.readSea('main')
  out.keptBoth = Boolean(back && back.points && back.points.length === 2)

  // 6 导出文本
  const exp = M.exportMirror('main')
  const dir = join(process.env.USERPROFILE, '.dsh', 'consciousness-mirror', 'main')
  out.exported = Boolean(exp && exp.ok !== false) && existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith('.md')).length >= 2

  console.log(JSON.stringify(out))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-first-hour-'))
// 2026-11-21：第七处同一个坑——插件里跑时 process.execPath 是桌面程序，
// 拿它去跑自己，起出来的是本体，孩子一句话不给。先认 node，认不到再找环境变量、最后退回 PATH。
const NODE = /node(\.exe)?$/i.test(process.execPath) ? process.execPath : (process.env.DSH_NODE || 'node')
const r = spawnSync(NODE, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_FIRST_HOUR: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const steps = [
  ['空着读不抛错', got.emptyReadOk],
  ['写第一条并自动建海', got.firstWrite && got.seaCreated],
  ['能列出这个海', got.seaListed],
  ['刚写的搜得回来', got.searchHits],
  ['第二条不覆盖第一条', got.secondWrite && got.keptBoth],
  ['能导出成文本', got.exported],
]
for (const [name, ok] of steps) console.log(`${ok ? '过' : '挂'}  ${name}`)
const allOk = steps.every(([, ok]) => ok)
console.log(allOk ? '陌生人第一小时：能自己走完。' : '不对：有一关过不去，别人第一条就卡住。')
process.exit(allOk ? 0 : 1)
