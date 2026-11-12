/**
 * 多窗口同时写同一个识海
 * =====================
 * 真实场景：两个窗口都在跟"她"聊，同一个识海同时被写。
 * 要验三件：
 *   1. 别丢：写完的总条数不能少
 *   2. 别坏：data.json 还能正常读、id 不断号
 *   3. 别假成功：拿不到锁的要明确说"排队"，不能报成功却没写进去
 *
 * 跑法：node scripts\sim-concurrent.mjs [并发数] [每人写几条]
 */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const N = Math.max(2, Number(process.argv[2] || 4))
const PER = Math.max(1, Number(process.argv[3] || 3))

const base = 'file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/'
const store = await import(base + 'lib/store.js')
const T = await import(base + 'lib/tools.js')

const SEA = 'conctest'
const dir = join(homedir(), '.dsh', 'consciousness-seas', SEA)
try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) } catch {}
store.writeSea(SEA, { version: 1, points: [], edges: [], createdAt: Date.now() })

let pass = 0
let fail = 0
const ok = (c, name, d) => { if (c) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (d ? '  → ' + d : '')) } }

console.log('\n' + N + ' 个写入者，每人写 ' + PER + ' 条，同一个识海')

const results = await Promise.all(
  Array.from({ length: N }, (_, w) => (async () => {
    const mine = []
    for (let i = 0; i < PER; i++) {
      const r = await T.addTool.execute({
        sea: SEA,
        title: '写入者' + w + '的第' + i + '条',
        text: '这条是并发写的，写入者' + w + '，序号' + i + '。',
        kind: 'fact', imp: 0.5,
      }, {})
      mine.push({ ok: !!(r && r.ok), log: String((r && r.log) || '').slice(0, 30) })
    }
    return mine
  })()),
)

const flat = results.flat()
const saidOk = flat.filter((x) => x.ok).length
const d = store.readSea(SEA)
const pts = (d.points || []).filter((p) => !p.dead)
const uniqueTitles = new Set(pts.map((p) => String(p.title)))
const ids = pts.map((p) => Number(p.id)).sort((a, b) => a - b)
const gap = ids.some((v, i) => i > 0 && v !== ids[i - 1] + 1)

console.log('\n  报成功的', saidOk, '/', flat.length)
console.log('  库里实际', pts.length, '条（去重标题', uniqueTitles.size, '个）')

ok(pts.length > 0, '没写崩，库里有东西')
ok(pts.length === saidOk, '实际条数 == 报成功的条数（不虚报）', pts.length + ' vs ' + saidOk)
ok(!gap, 'id 没断号', gap ? '有断号' : '')
ok(uniqueTitles.size === pts.length, '没有重复写同一条', uniqueTitles.size + ' vs ' + pts.length)

const expect = N * PER
ok(pts.length === expect, '该写的都写进去了（' + expect + ' 条）', '实际 ' + pts.length)

try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) } catch {}
console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
