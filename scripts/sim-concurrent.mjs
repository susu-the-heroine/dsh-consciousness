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
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const N = Math.max(2, Number(process.argv[2] || 4))
const PER = Math.max(1, Number(process.argv[3] || 3))

// 2026-11-21：这份原来在**真库**里建一个名叫 conctest 的海，跑完还整个删掉——
// 万一用户真有同名的海，一跑就没。改成先造临时家目录，再引库；跑完连临时家一起清。
const _tmpHome = mkdtempSync(join(tmpdir(), 'c2-conc-'))
process.env.USERPROFILE = _tmpHome
process.env.HOME = _tmpHome
mkdirSync(join(_tmpHome, '.dsh'), { recursive: true })

// 路径也不写死本机：按本文件位置算。
const base = 'file:///' + join(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/') + '/'
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
      // 2026-11-21：原来十几条的标题和正文几乎一样（只差一个号码），
      // 被近重复闸当场挡下——库里只剩两条，看着像「并发丢写」，其实是自己撞自己的闸。
      // 每一句给一个互不相同的具体物件，闸就不会误判。
      // 物件表放十二个，第 (w*3+i) 个取用——四个写入者各三条，取的永远是不同的一对。
      const 物件 = ['搪瓷缸', '旧风扇', '铜钥匙', '蓝雨伞', '木凳子', '铁皮盒',
        '白瓷碗', '竹躺椅', '铝饭盒', '玻璃杯', '铁皮桶', '竹书架']
      const 动作 = ['摔了一下', '搬上三楼', '落在窗台', '借给邻居', '收进抽屉', '擦了一遍',
        '拿去修了', '搁在门后', '换成新的', '晒了两天', '垫了块布', '记在本上']
      // 2026-11-21 二改：上一版按公式取物+动作，四个写入者会撞出完全相同的句子（白瓷碗那对就是），
      // 又被近重复闸挡下一条。改成把「谁、第几回」写进正文和标题，句句不同名不同句。
      const 序 = (w * 3 + i) % 12
      const 物 = 物件[序]
      const 动 = 动作[序]
      const r = await T.addTool.execute({
        sea: SEA,
        title: '写入者' + w + '第' + i + '回记' + 物,
        text: '第' + w + '个写入者的第' + i + '回：他把' + 物 + 动 + '，这是并发写下的第' + (w * 10 + i) + '号样本。',
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

// 2026-11-21：原来这条要求「十二次调用必须落十二次」，可头注释自己写着
//「拿不到锁的要明确说排队」——被拒是对的行为，不是丢写。改成两头都对得上才算过：
// 入库数 = 报成功数（不虚报），被拒的都说清了是排队，入库 + 被拒 = 该写总数。
const expect = N * PER
const refused = flat.filter((x) => !x.ok)
const refusedSaid = refused.every((x) => /正在被别的窗口写|等几秒再试/.test(x.log))
ok(refusedSaid, '被拒的都明说了在排队（' + refused.length + ' 条）', refused.map((x) => x.log).join(' | '))
ok(pts.length + refused.length === expect, '入库 + 明说排队 = 该写总数（' + expect + '）', '入库 ' + pts.length + ' + 排队 ' + refused.length)

try { if (existsSync(_tmpHome)) rmSync(_tmpHome, { recursive: true, force: true }) } catch {}
console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
