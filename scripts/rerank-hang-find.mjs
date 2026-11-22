/**
 * 找“学习重排开着就挂住”到底卡在哪一条
 * ==================================
 *   node scripts/rerank-hang-find.mjs
 *
 * 做法：临时库、开着重排、逐条跑；每跑一条前把问句写进 trace 文件。
 * 卡住时 trace 文件最后一行就是那条。默认最多等每条 20 秒，超时就记为可疑并继续。
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL = homedir()
const tmp = mkdtempSync(join(tmpdir(), 'rrh-'))
mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })
cpSync(join(REAL, '.dsh', 'consciousness-seas', 'main'), join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
process.env.USERPROFILE = tmp
process.env.HOME = tmp
process.env.C2_RERANK_MODEL = '1'

const trace = join(HERE, 'data', 'rerank-trace.log')
writeFileSync(trace, '', 'utf8')

const cases = (JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || [])
  .filter((c) => c && c.q && c.want)
const limit = Number(process.env.C2_HANG_LIMIT || 0)
const list = limit ? cases.slice(0, limit) : cases

const { searchTool } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms).unref?.()),
])

let slow = []
// 2026-11-21：这是个「专门找挂住」的脚本——被中断是它的日常，不是意外。
// 可它把整份库拷进临时家，却没有兜底：中途一停，一百来兆就躺在地上。
// 跟 blind-run 同一个毛病，同样补 try/finally。
try {
for (let i = 0; i < list.length; i++) {
  const q = list[i].q
  appendFileSync(trace, i + '\t' + q + '\n', 'utf8')
  const t0 = Date.now()
  try {
    await withTimeout(searchTool.execute({ query: q, limit: 5, review: false }), 20000)
    const ms = Date.now() - t0
    if (ms > 2000) { slow.push([i, ms, q]); appendFileSync(trace, '  SLOW ' + ms + 'ms\n', 'utf8') }
  } catch (e) {
    appendFileSync(trace, '  STUCK ' + String((e && e.message) || e) + '\n', 'utf8')
    slow.push([i, -1, q])
  }
}
console.log('跑完 ' + list.length + ' 条，慢或卡住 ' + slow.length + ' 条')
for (const [i, ms, q] of slow.slice(0, 20)) console.log('  #' + i, ms < 0 ? '卡住' : ms + 'ms', q)
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
}
process.exit(0)
