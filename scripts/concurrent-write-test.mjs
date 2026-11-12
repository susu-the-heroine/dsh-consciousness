/**
 * 并发写入压测
 * ============
 *
 * 开六个进程，同时往同一个沙箱库各写十条。看：
 *   1. 进去几条（应该是 60 条，一条不丢）
 *   2. 有没有写坏的 JSON
 *   3. 锁有没有留在盘上
 *   4. 有没有残留 .tmp
 *
 * 为什么要测：当年 Python 那条路没拿锁，四个窗口同时写，12 条只进去 3 条。
 * 现在 JS 拿锁了，但"拿锁"这回事没在多进程下验证过。
 *
 * 跑法：node scripts/concurrent-write-test.mjs [进程数] [每进程条数]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const N = Number(process.argv[2] || 6)
const M = Number(process.argv[3] || 10)

// ── worker 模式：被父进程叫起来，写十条就退
if (process.argv.includes('--worker')) {
  const tag = process.argv[process.argv.indexOf('--worker') + 1]
  const M = Number(process.env.WORKER_M || 10)   // 别再读 argv[3]：那里是进程号
  const W = await import('file:///' + join(HERE, '..', 'lib', 'write-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
  let ok = 0
  for (let i = 0; i < M; i++) {
    const r = W.writeOne('main', {
      title: `并发-${tag}-${i}`,
      text: `第 ${tag} 个进程的第 ${i} 条，内容各不相同避免被重试闸拦住。序号 ${tag}x${i}。`,
      kind: 'fact',
    })
    if (r.ok) ok++
  }
  process.exit(ok === M ? 0 : 2)
}

const home = mkdtempSync(join(tmpdir(), 'conc-'))
const env = { ...process.env, USERPROFILE: home, HOME: home, WORKER_M: String(M) }

const runs = []
for (let t = 0; t < N; t++) {
  runs.push(new Promise((resolve) => {
    const c = spawn(process.execPath, [SELF, '--worker', String(t)], { env, windowsHide: true })
    let err = ''
    c.stderr.on('data', (d) => { err += String(d) })
    c.on('close', (code) => resolve({ t, code, err }))
  }))
}
const res = await Promise.all(runs)
const bad = res.filter((r) => r.code !== 0)
console.log(`进程完成：${N - bad.length}/${N}`)
for (const b of bad.slice(0, 3)) console.log(`  进程 ${b.t} 退出码 ${b.code}  ${(b.err || '').slice(0, 120)}`)

const sea = join(home, '.dsh', 'consciousness-seas', 'main')
let alive = 0
let edges = 0
let broken = ''
try {
  const d = JSON.parse(readFileSync(join(sea, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
  alive = (d.points || []).filter((x) => !x.dead).length
  edges = (d.edges || []).length
} catch (e) {
  broken = String((e && e.message) || e)
}
const lockLeft = existsSync(join(sea, 'data.json.lock'))
const tmpLeft = existsSync(sea) ? readdirSync(sea).filter((f) => f.endsWith('.tmp')) : []

const want = N * M
let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓ ' + name) } else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

ok('库能解析（没写坏）', !broken, broken)
ok(`一条不丢（要 ${want} 条）`, alive === want, '实际 ' + alive)
ok('锁没留在盘上', !lockLeft)
ok('没有残留 .tmp', tmpLeft.length === 0, String(tmpLeft))
ok('边也建起来了', edges > 0, '边数 ' + edges)

rmSync(home, { recursive: true, force: true })
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
