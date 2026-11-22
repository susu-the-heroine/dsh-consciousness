/**
 * 向量健康度与界面自测
 * ====================
 *   node scripts/test-vector-health.mjs
 *
 * 两件事：接口字段齐；工作台里真有「索引」这一页、真去读健康度。
 * 只读文件、只在沙箱海里算，不改任何东西。
 */
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'sea-hl-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(process.cwd(), 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const V = await import(LIB + '/vectors.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const now = Date.now()
writeSea('main', {
  version: 3,
  points: [
    { id: 1, title: '一条', text: '内容一', born: now - 1000 },
    { id: 2, title: '两条', text: '内容二', born: now - 2000 },
  ],
  edges: [],
})

const h = V.vectorHealth('main', { version: 3, points: [{ id: 1 }, { id: 2 }], edges: [] })
ok('健康度有覆盖率', Number.isFinite(Number(h.coverage)), JSON.stringify(h.coverage))
ok('健康度有陈旧率', Number.isFinite(Number(h.stale_rate)), String(h.stale_rate))
ok('健康度有队列', Number.isFinite(Number(h.queued)), String(h.queued))
ok('健康度有延迟', Number.isFinite(Number(h.p95_ms)), String(h.p95_ms))
ok('健康度带模型与维度', !!h.model && Number(h.dim) > 0, h.model + '/' + h.dim)
ok('健康度带体积', Number.isFinite(Number(h.bytes)) && Number.isFinite(Number(h.bin_bytes)), String(h.bytes))

const page = readFileSync(join(process.cwd(), 'assets', '工作台.html'), 'utf8')
ok('工作台有索引页签', page.includes('data-p="index"') && page.includes('>索引<'), '')
ok('工作台读健康度接口', page.includes("/consciousness/vectors?action=health"), '')
ok('工作台能补一批', page.includes('action=run'), '')
ok('工作台显示覆盖率与队列', page.includes('覆盖') && page.includes('队列'), '')

console.log(`\n健康度与界面自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
