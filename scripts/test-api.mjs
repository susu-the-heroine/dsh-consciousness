/**
 * 接口自测：起一个服务器，自己打自己
 * =================================
 *
 *   node scripts/test-api.mjs
 *
 * 验五件事：
 *   1) /health 不用令牌也能通
 *   2) 不带令牌打 /search 是 401
 *   3) 带令牌查一条，能拿到人话答案
 *   4) 接口答案与直接调工具逐字相同（同一套实现）
 *   5) 只读模式下 /write 是 403
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：服务和工具都按当前目录找——换个目录跑就断在 file:///C:/bin。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
import { tmpdir } from 'node:os'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'

// 2026-11-21：这份原来没把家目录指到沙箱——实测跑一遍，真家目录里三份文件被写了：
// 审计日志、心脏快照、检索日志（各涨了几百到两千字节）。「测试只碰沙箱海」是铁规矩，
// 这条自己就破了。改成先造临时家、铺一条能查到的记忆，再起服务。
const home = mkdtempSync(join(tmpdir(), 'c2-api-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
writeFileSync(join(home, '.dsh', 'consciousness-seas', 'main', 'data.json'), JSON.stringify({
  schemaVersion: 3,
  points: [{ id: 1, title: '显卡', text: '显卡那件事：换了张卡，风扇吵。', born: Date.now(), lastSeen: Date.now(), imp: 0.6, kind: 'fact' }],
  edges: [],
}), 'utf8')

const API = 'file:///' + join(HERE, '..', 'bin', 'sea-api.mjs').replace(/\\/g, '/')
const { createServer, TOKEN } = await import(API)

const srv = createServer()
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
const port = srv.address().port
const base = `http://127.0.0.1:${port}`
const tok = TOKEN

const call = async (path, opts = {}) => {
  const r = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth === false ? {} : { authorization: 'Bearer ' + tok }) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const h = await call('/health', { auth: false })
check('health 不用令牌', h.status === 200 && h.body && h.body.ok === true, JSON.stringify(h.body))

const noAuth = await call('/search', { method: 'POST', body: { query: 'x' }, auth: false })
check('没令牌是 401', noAuth.status === 401, String(noAuth.status))

const q = '显卡那件事'
const viaApi = await call('/search', { method: 'POST', body: { query: q, limit: 3, review: false } })
check('带令牌能查', viaApi.status === 200 && viaApi.body.ok === true, JSON.stringify(viaApi.body).slice(0, 120))

// 与直接调工具对比
const { searchTool } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
const direct = await searchTool.execute({ query: q, limit: 3, review: false })
const viaLog = viaApi.body && viaApi.body.result && viaApi.body.result.log
// 2026-11-21：答案尾巴上带着每次查询的流水号（logId=...），两次调用必然不同。
// 原来比整串，等于在比两个不同的编号——在他那台机器上碰巧没触发这句提示才一直绿。
// 逐字比较要去掉流水号：比的是「同一套实现给出的同一段话」，不是比编号。
const stripId = (t) => String(t || '').replace(/logId=[^；;）)\s]*/g, 'logId=*')
check('接口答案与工具逐字相同（流水号除外）', stripId(viaLog) === stripId(direct && direct.log),
  String(viaLog || '').slice(0, 60) + ' vs ' + String(direct && direct.log || '').slice(0, 60))

const w = await call('/write', { method: 'POST', body: { title: 'x', text: 'y' } })
check('只读时写是 403', w.status === 403, String(w.status))

srv.close()
try { rmSync(home, { recursive: true, force: true }) } catch {}
console.log(`\n接口自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
