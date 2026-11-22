/**
 * 接口与工具同一份答案 · 自测
 *
 * 同一个识海、同一句问话，走 HTTP 接口和走工具，前五名必须一模一样。
 * 2026-11-19 之前是两套排法：接口走简版，工具走完整，同一句话给两组答案。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/routes.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'parity-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const sea = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(sea, { recursive: true })
const now = Date.now()
const pts = [
  [1, '济南经十路', '经十路是那条走不到头的马路，晚上骑车的日子全在这条路上。'],
  [2, '大路虎', '家里的车，出门就开它。'],
  [3, '七套房', '家里有七套房，他说这是家里的，不是我挣的。'],
  [4, '肥建军', '我爸叫肥建军，是个接头暗号。'],
  [5, '白饭梗', '白饭糊脸那段，是短视频里最出名的一刀。'],
]
writeFileSync(join(sea, 'data.json'), JSON.stringify({
  version: 1,
  points: pts.map(([id, title, text]) => ({
    id, title, text, kind: 'fact', born: now - id * 86400000, strength: 40, layer: 'experience', imp: 0.6, arousal: 4,
  })),
  edges: [],
}), 'utf8')

const base = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const handlers = []
const ctx = {
  webServer: { register: (h) => handlers.push(h) },
  effect: (fn) => { try { fn() } catch {} return () => {} },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  on() {},
  config: {},
}
const R = await import(base + '/routes.js')
R.mountRoutes(ctx)
const T = await import(base + '/tools.js')

const call = async (q) => {
  const h = handlers.find((x) => x && x.path === '/consciousness/mcp')
  let body = ''
  await h.handler(
    { url: '/consciousness/mcp?action=sea_search&q=' + encodeURIComponent(q) + '&limit=5', method: 'GET', headers: {} },
    { writeHead() {}, end: (b) => { body = String(b) } },
  )
  const j = JSON.parse(body)
  return (j.results || []).map((x) => Number(x.id))
}
const tool = async (q) => {
  const r = await T.searchTool.execute({ query: q, limit: 5, review: false })
  return [...String(r.log || '').matchAll(/· #(\d+)/g)].map((m) => Number(m[1]))
}

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

let atLeastOne = 0
for (const q of ['经十路', '七套房', '经十路那条路']) {
  const a = await call(q)
  const b = await tool(q)
  if (a.length || b.length) atLeastOne++
  t(`「${q}」两份答案一致`, JSON.stringify(a) === JSON.stringify(b), `接口=${a.join(',')} 工具=${b.join(',')}`)
}
t('至少有一句两边都给得出', atLeastOne > 0, String(atLeastOne))

console.log(`接口与工具一致：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
