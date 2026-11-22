/**
 * 两个海会不会串味
 * ================
 *
 *   node scripts/sea-isolation-test.mjs
 *
 * 别人用的时候往往不止一个海（工作一个、私人一个）。要验：
 *   1. 建第二个海不影响第一个
 *   2. 在 A 里搜不到只在 B 里的词
 *   3. 列海能看到两个
 *   4. 删掉 B 不影响 A
 *
 * 全程临时家目录。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.env.DSH_SEA_ISO === '1') {
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
  const SEAS = await import('file:///' + join(HERE, '..', 'lib', 'seas.js').replace(/\\/g, '/'))
  const out = {}

  const t = Date.now()
  const A = { points: [{ id: 1, title: '鱼塘的事', text: '鱼塘那边的蓝色大肥鱼模型，工坊里下的。', bornAt: t, at: t }] }
  const B = { points: [{ id: 1, title: '药的事', text: '八天吊针，两头都是头孢，洋葱圈划舌头。', bornAt: t, at: t }] }

  // 走正经建海那条路（会写 meta），否则列海看不见——这是接口约定，不是我漏了
  try { S.ensureSea('work') } catch {}
  try { S.ensureSea('private') } catch {}
  out.writeA = S.writeSea('work', A) !== false
  out.writeB = S.writeSea('private', B) !== false

  const list = (() => { try { return SEAS.listSeas() } catch { return [] } })()
  out.listed = Array.isArray(list) ? list.map((x) => String((x && (x.id || x.name)) || x)) : []

  // A 里搜 B 的独有词，应该搜不到 B 的那条
  let hitInA = null
  try { hitInA = await T.searchTool.execute({ sea: 'work', query: '八天吊针 洋葱圈' }) } catch { hitInA = null }
  out.noLeak = !(hitInA && hitInA.ok !== false && String(hitInA.log || '').includes('药的事'))

  // A 自己那条还搜得到
  let hitOwn = null
  try { hitOwn = await T.searchTool.execute({ sea: 'work', query: '鱼塘 模型 工坊' }) } catch { hitOwn = null }
  out.ownFound = Boolean(hitOwn && hitOwn.ok !== false && (String(hitOwn.log || '').includes('鱼塘') || String(hitOwn.log || '').includes('模型')))

  // 只有 data.json、没有 meta 的海（有人直接拷目录过来）也要列得出来
  try {
    const bareDir = join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'copied')
    mkdirSync(bareDir, { recursive: true })
    writeFileSync(join(bareDir, 'data.json'), JSON.stringify({ points: [{ id: 1, title: '拷过来的', text: '只拷了数据文件。', bornAt: t, at: t }] }), 'utf8')
    const list2 = (() => { try { return SEAS.listSeas() } catch { return [] } })()
    out.bareListed = Array.isArray(list2) && list2.some((x) => String((x && (x.id || x.name)) || x) === 'copied')
  } catch { out.bareListed = false }

  // 删掉 private，work 还在
  try { S.deleteSea ? S.deleteSea('private') : null } catch {}
  rmSync(join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'private'), { recursive: true, force: true })
  const a = S.readSea('work')
  out.aAlive = Boolean(a && a.points && a.points.length === 1)

  console.log(JSON.stringify(out))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-seaiso-'))
// 2026-11-21：第八处同一个写法。插件里跑时 process.execPath 是桌面程序，
// 拿它起自己等于起本体，孩子不出声。先认 node，认不到找环境变量、最后退回 PATH。
const NODE = /node(\.exe)?$/i.test(process.execPath) ? process.execPath : (process.env.DSH_NODE || 'node')
const r = spawnSync(NODE, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  // 2026-11-21：只改 USERPROFILE 不改 HOME——这条路在 Windows 上够用（系统取家目录先看 USERPROFILE），
  // 可在别处，取家目录看的是 HOME，于是子进程会往真家目录里写，跟上面那句「全程临时家目录」不符。
  // 同一个目录下空库那条测试两个变量都改了，这里漏了一个。
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_SEA_ISO: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const steps = [
  ['两个海都写进去了', got.writeA && got.writeB],
  ['列海能看到两个', Array.isArray(got.listed) && got.listed.includes('work') && got.listed.includes('private')],
  ['A 里搜不到 B 的事', got.noLeak],
  ['A 自己那条搜得到', got.ownFound],
  ['只拷 data.json 的海也列得出来', got.bareListed],
  ['删掉 B 之后 A 还在', got.aAlive],
]
for (const [name, ok] of steps) console.log(`${ok ? '过' : '挂'}  ${name}`)
const allOk = steps.every(([, ok]) => ok)
console.log(allOk ? '两个海各过各的，不串味。' : '不对：海之间串了，或者删一个动了另一个。')
process.exit(allOk ? 0 : 1)
