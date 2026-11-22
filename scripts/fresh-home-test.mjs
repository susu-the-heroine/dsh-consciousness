import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 空白机器首次运行
 * ==============
 *
 *   node scripts/fresh-home-test.mjs
 *
 * 别人装完第一次打开，`~/.dsh` 底下**什么都没有**。
 * 这个测试把 HOME 指到一个空目录里，让插件从那开始：建目录、建海、写三条、读回来、列清单。
 * 只要有一处假设"文件已经在了"，这里就红。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.argv[2] === '--child') {
  const out = []
  const store = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
  const seas = await import('file:///' + join(HERE, '..', 'lib', 'seas.js').replace(/\\/g, '/'))

  // 1. 什么都没有的时候读：只要不抛就行。
  // 返回空也算对——第一次用本来就没有数据，调用方得自己判空。
  let before = null
  let threw = null
  try { before = store.readSea('main') } catch (e) { threw = e }
  out.push(['空目录里读 main 不抛', threw === null])
  out.push(['空的时候给的是空东西，不是半截', threw === null ? (before === null || before === undefined || (Array.isArray(before.points) && before.points.length === 0)) : false])

  // 2. 模拟插件开机：ensureSamples 会自己把主海建出来。
  //    这一步要是漏了，后面所有 readSea(...).points 都会撞 null。
  let bootErr = null
  try { seas.ensureSamples() } catch (e) { bootErr = e }
  out.push(['开机自建主海不抛', bootErr === null])
  // 真实行为：开机只铺示例海（assets/samples 里那八个），主海是**你写第一条**的时候才建的。
  // 所以这里不要求 main 已经存在——只要求示例海铺出来了、放不下也不炸。
  const listed = seas.listSeas()
  out.push(['开机铺了示例海', Array.isArray(listed) && listed.length >= 1])
  const mainNow = store.readSea('main')
  out.push(['这时候还没写，main 是空的（返回空，不是半截）', mainNow === null || (Array.isArray(mainNow.points) && mainNow.points.length === 0)])

  // 3. 建海 + 写三条
  store.ensureSea('main', '主')
  const data = {
    version: 1,
    points: [1, 2, 3].map((i) => ({ id: i, title: '第一条 ' + i, text: '第一次用写的第 ' + i + ' 条', born: Date.now(), lastSeen: Date.now(), imp: 0.5, kind: 'fact' })),
    edges: [],
  }
  const wrote = store.writeSea('main', data)
  out.push(['写三条返回 true', wrote === true])

  // 4. 读回来
  const after = store.readSea('main')
  out.push(['读回来三条', Array.isArray(after.points) && after.points.length === 3])

  // 5. 元信息
  store.writeMeta('main', { name: '主', born: Date.now() })
  out.push(['元信息能读', !!store.readMeta('main')])

  // 6. 清单能列
  const list = seas.listSeas()
  out.push(['清单是个数组', Array.isArray(list)])
  out.push(['清单里有 main', list.some((s) => (s.id || s.sea || s) === 'main')])

  let bad = 0
  for (const [name, ok] of out) {
    if (!ok) bad++
    console.log(`${ok ? '过' : '挂'}  ${name}`)
  }
  console.log(bad === 0 ? 'CHILD_OK' : 'CHILD_BAD')
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'shihai-fresh-'))
// 空目录：连 .dsh 都不要预先建，这才是"第一次"
const r = spawnSync(_nodeBin, [SELF, '--child'], {
  encoding: 'utf8',
  env: { ...process.env, USERPROFILE: home, HOME: home },
  timeout: 120000,
})

const out = String(r.stdout || '')
process.stdout.write(out.replace(/^CHILD_OK$/m, '').replace(/^CHILD_BAD$/m, ''))

const ok = r.status === 0 && /CHILD_OK/.test(out)
let leftovers = []
try { leftovers = readdirSync(join(home, '.dsh')) } catch {}
rmSync(home, { recursive: true, force: true })

if (ok) {
  console.log(`空白机器：能自己长出目录、建海、写读都对。临时目录里后来多了 ${leftovers.length} 项：${leftovers.slice(0, 6).join(' ')}`)
} else {
  console.log('空白机器上挂了，看上面哪条标"挂"，或 stderr：')
  console.log(String(r.stderr || '').split('\n').slice(0, 6).join('\n'))
}
process.exit(ok ? 0 : 1)
