import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 改调参文件，要不要重启才生效
 * ==========================
 *
 *   node scripts/tuning-live-test.mjs
 *
 * 自己开一个假用户目录（USERPROFILE 指到临时目录），在那边写调参文件、改一次、再读一次。
 * 期望：改完立刻读到新值，不用重启。真实的调参文件一个字都不动。
 * 2026-11-15 实测：标题权重 3 → 10 当场生效。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.env.DSH_TUNING_CHILD === '1') {
  // 子进程：在别人给的家目录里读两次调参
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tuning.js').replace(/\\/g, '/'))
  const first = T.tuning().titleBoost
  const cfg = join(process.env.USERPROFILE, '.dsh', 'consciousness-tuning.json')
  writeFileSync(cfg, JSON.stringify({ titleBoost: first + 7 }), 'utf8')
  await new Promise((r) => setTimeout(r, 60))
  const second = T.tuning().titleBoost
  console.log(JSON.stringify({ first, second }))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-tuning-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
writeFileSync(join(home, '.dsh', 'consciousness-tuning.json'), JSON.stringify({ titleBoost: 3 }), 'utf8')

const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 30000,
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_TUNING_CHILD: '1' },
})

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
rmSync(home, { recursive: true, force: true })

if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 200))
  process.exit(1)
}

console.log(`改前 ${got.first} · 改文件后立刻读到 ${got.second}`)
const ok = Number(got.first) === 3 && Number(got.second) === 10
console.log(ok ? '调参不用重启，改了就是新的。' : '不对：调参没跟着文件走，得像改代码一样重启才生效。')
process.exit(ok ? 0 : 1)
