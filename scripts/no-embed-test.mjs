import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 只装代码包、没装模型包，还能不能搜
 * ==================================
 *
 *   node scripts/no-embed-test.mjs
 *
 * 有人只下 17 MB 的代码包，不装 19 MB 的模型包。这时没有向量，
 * 检索应该降级成直扫，而不是塌掉、也不是一无所获。
 *
 * 全程临时目录，不碰真库。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.env.DSH_NOEMBED === '1') {
  const { homedir } = await import('node:os')
  if (!/c2-noembed-/.test(homedir())) {
    console.log(JSON.stringify({ fatal: '没跑在临时目录，拒绝执行' }))
    process.exit(2)
  }
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
  let r = null
  try { r = await T.searchTool.execute({ sea: 'plain', query: '楼下抽烟' }) } catch (e) { r = { err: String(e && e.message) } }
  const log = String((r && (r.log || r.text)) || '')
  console.log(JSON.stringify({
    ok: Boolean(r && r.ok !== false),
    found: log.includes('楼下的烟'),
    degraded: /直扫|凑出来/.test(log),
    crashed: Boolean(r && r.err),
  }))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-noembed-'))
const seas = join(home, '.dsh', 'consciousness-seas', 'plain')
mkdirSync(seas, { recursive: true })
const now = Date.now()
writeFileSync(join(seas, 'data.json'), JSON.stringify({
  points: [
    { id: 1, title: '楼下的烟', text: '那天下午三点在楼下抽了一根，想的是明天的活。', bornAt: now, at: now },
    { id: 2, title: '咖啡的钱', text: '拿铁大杯二十一块，燕麦奶加三块。', bornAt: now, at: now },
  ],
}), 'utf8')
writeFileSync(join(seas, 'meta.json'), JSON.stringify({ count: 2 }), 'utf8')
// 故意不放 vectors.json、不放 memory.db：模拟没装模型包

const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  // 2026-11-21：只改用户目录变量、没改家目录变量——这台机器够用，换个系统子进程会往真家目录写。
  // 它自己有一道「跑在临时目录才许执行」的闸，能兜住最坏情况；但两个变量都该改。
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_NOEMBED: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const steps = [
  ['没崩', !got.crashed && got.ok],
  ['照样搜得到', got.found],
  ['知道自己是在硬找', got.degraded],
]
for (const [name, ok] of steps) console.log(`${ok ? '过' : '挂'}  ${name}`)
const allOk = steps.every(([, ok]) => ok)
console.log(allOk ? '没装模型包也能用，只是老实说自己是在凑。' : '不对：没向量就塌了，或者硬说找到了。')
process.exit(allOk ? 0 : 1)
