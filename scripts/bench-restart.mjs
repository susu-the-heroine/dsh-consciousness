/**
 * 重启后首问（索引真的落了盘）
 * ==========================
 *
 *   node scripts/bench-restart.mjs prepare   造两千条、建索引、落盘
 *   node scripts/bench-restart.mjs measure   新进程里读盘上索引、量首问
 *
 * 两个进程共用同一个临时目录（C2_RESTART_HOME），模拟「关掉再开」。
 * 跑完 prepare 的目录由 measure 负责删。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = String(process.env.C2_RESTART_HOME || '').trim()
if (!home) { console.log('缺 C2_RESTART_HOME'); process.exit(1) }
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const mode = String(process.argv[2] || 'measure')

if (mode === 'prepare') {
  const { SEAS_DIR } = await import(LIB + '/paths.js')
  const VX = await import(LIB + '/vecstore.js')
  const { loadVectors } = await import(LIB + '/vectors.js')
  const ann = await import(LIB + '/ann.js')
  const sea = 'r'
  mkdirSync(join(SEAS_DIR, sea), { recursive: true })
  const ent = []
  for (let i = 1; i <= 2000; i++) {
    const v = new Float32Array(512)
    for (let k = 0; k < 512; k++) v[k] = Math.sin(i * 0.017 + k * 0.23)
    ent.push({ id: i, v, h: 'r' + i })
  }
  // 只有向量没有点，检索是空的：得把点也造出来，才试得到按需读
  const now = Date.now()
  const pts = ent.map((e, i) => ({
    id: e.id,
    title: i % 50 === 0 ? '经十路第' + e.id + '段' : '普通记忆' + e.id,
    text: i % 50 === 0 ? '济南经十路，走了很多年。' : '一件普通的事，编号' + e.id,
    kind: 'fact',
    imp: 0.6,
    arousal: 4,
    born: now - (i + 1) * 60000,
    strength: 30,
    layer: 'experience',
  }))
  writeFileSync(join(SEAS_DIR, sea, 'data.json'), JSON.stringify({ version: 1, points: pts, edges: [] }), 'utf8')
  VX.putMany(sea, ent)
  const vmap = loadVectors(sea)
  const t = Date.now()
  const box = ann.build(sea, vmap)
  ann.saveDisk(sea, box)
  console.log(`prepare：建索引 ${Date.now() - t}ms · k=${box.k} · 已落盘`)
  process.exit(0)
}

// measure：新进程，先读盘，再首问
const t0 = Date.now()
const ann = await import(LIB + '/ann.js')
const idx = ann.loadDisk('r', 'single')
const tLoad = Date.now()
// 沙箱是新 HOME，质量档默认是省电档——不开高档，向量那层根本不跑
try { const Q = await import(LIB + '/quality.js'); Q.setQuality && Q.setQuality(3) } catch {}
const { searchTool, LAST_LOAD } = await import(LIB + '/tools.js')
const tMod = Date.now()
const q1 = '鲸鱼为什么要在深海里唱歌'
const q2 = '那天晚上在桥底下抽烟到底为了什么'
const r = await searchTool.execute({ query: q1, limit: 3, review: false, sea: 'r' })
const t1 = Date.now()
const r2 = await searchTool.execute({ query: q1, limit: 3, review: false, sea: 'r' })
const t2 = Date.now()
const r3 = await searchTool.execute({ query: q2, limit: 3, review: false, sea: 'r' })
const t3 = Date.now()
console.log(`第二问（同一句）${t2 - t1}ms · 第三问（换句）${t3 - t2}ms`)
console.log(`measure：读索引 ${tLoad - t0}ms（${idx ? 'k=' + idx.k : '没读到'}）· 加载模块 ${tMod - tLoad}ms · 首问 ${t1 - tMod}ms`)
try { const P = await import(LIB + '/prof.js'); const rec = P.recent.slice(-3); for (const x of rec) console.log('原始：' + JSON.stringify(x).slice(0, 260)) } catch {}
console.log('首行：' + JSON.stringify(String(r.log || '').slice(0, 50)))
console.log('载入方式：' + JSON.stringify(LAST_LOAD) + ' · 命中条数：' + (String(r.log || '').match(/· #\d+/g) || []).length)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(0)
