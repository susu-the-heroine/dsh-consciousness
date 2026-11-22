/**
 * 多进程写同一个海（事务式）
 * ==========================
 *   node scripts/test-mutate.mjs
 *
 * 四个进程各写五十次，最后必须正好两百条、JSON 能读。
 * 用 mutateSea：读—改—写整段在一把锁里；老的 writeSea 只锁「写」，
 * 两个进程各读旧快照再写会互相吞（实测丢四分之三）。
 * 全程临时目录，碰不到真库。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
import { spawn } from 'node:child_process'

const home = mkdtempSync(join(tmpdir(), 'seamut-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea, readSea, seaPath } = await import(LIB + '/store.js')

const SEA = '__mut_' + Date.now()
let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

writeSea(SEA, { version: 3, points: [], edges: [] })

const worker = join(home, 'worker.mjs')
writeFileSync(worker, [
  'process.env.USERPROFILE = ' + JSON.stringify(home),
  'process.env.HOME = ' + JSON.stringify(home),
  "import('" + LIB + "/store.js').then((S) => {",
  '  const tag = process.argv[2]',
  '  for (let i = 0; i < 50; i++) {',
  "    S.mutateSea('" + SEA + "', (d) => {",
  '      d.points = d.points || []',
  "      d.points.push({ id: tag + '-' + i, title: tag + ' ' + i, text: 'x' })",
  '      return d',
  '    })',
  '  }',
  '})',
].join('\n'), 'utf8')

// 2026-11-21：桌面版里 process.execPath 是 DeepSeek Harness.exe，不是 node。
// 照它起子进程等于把窗口程序当解释器，四个工人全跑不起来。默认拿它起，跑不通再用 PATH 上的 node。
const NODE = (/node(\.exe)?$/i.test(process.execPath) ? process.execPath : (process.env.DSH_NODE || 'node'))

const run = (tag) => new Promise((resolve) => {
  const p = spawn(NODE, [worker, tag], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (c) => { out += c })
  p.stderr.on('data', (c) => { out += c })
  p.on('close', (code) => resolve({ code, out }))
})

const res = await Promise.all([run('a'), run('b'), run('c'), run('d')])
const bad = res.filter((r) => r.code !== 0)
ok('四个进程都跑完', bad.length === 0, bad.map((b) => b.out.slice(-120)).join(' | '))

const data = readSea(SEA)
ok('库还读得出来', !!data && Array.isArray(data.points))
ok('两百条一条没丢', (data.points || []).length === 200, String((data.points || []).length))

const raw = JSON.parse(readFileSync(seaPath(SEA), 'utf8'))
ok('落盘 JSON 完整', Array.isArray(raw.points) && raw.points.length === 200, String(raw.points && raw.points.length))

console.log(`\n写锁自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
