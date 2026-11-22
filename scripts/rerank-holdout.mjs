import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 重排到底值不值得训：在留出集上比一次
 * ====================================
 *   node scripts/rerank-holdout.mjs
 *
 * 两臂各起一个子进程（各有自己的临时库与开关），跑同一批题：
 * 一臂关掉学习重排，一臂打开。题量小、跑得快，用来回答"要不要花时间训它"。
 *
 * 判据：打开那一臂若没有明显更好（+1 个百分点），就认定不值得训，保持默认关闭。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const REAL = homedir()

const all = (JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || [])
  .filter((c) => c && c.q && c.want)

const pick = () => {
  const holdout = all.filter((c) => String(c.kind || '') === 'holdout')
  const titles = all.filter((c) => String(c.kind || '') === 'title').slice(0, 100)
  return [...holdout, ...titles]
}

if (process.argv[2] === '--arm') {
  const on = process.argv[3] === 'on'
  const tmp = mkdtempSync(join(tmpdir(), 'rho-'))
  mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })
  cpSync(join(REAL, '.dsh', 'consciousness-seas', 'main'), join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
  process.env.USERPROFILE = tmp
  process.env.HOME = tmp
  process.env.C2_RERANK_MODEL = on ? '1' : '0'
  const { searchTool } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
  const cases = pick()
  let hit = 0
  for (const c of cases) {
    const r = await searchTool.execute({ query: c.q, limit: 5, review: false })
    const m = String(r.log || '').match(/^· #(\d+)/m)
    if (m && Number(m[1]) === Number(c.want)) hit++
  }
  console.log(JSON.stringify({ hit, n: cases.length }))
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  process.exit(0)
}

const runArm = (on) => {
  const r = spawnSync(_nodeBin, [SELF, '--arm', on ? 'on' : 'off'], { encoding: 'utf8', timeout: 600000 })
  const line = String(r.stdout || '').trim().split('\n').filter((x) => x.startsWith('{')).pop()
  if (!line) throw new Error('子进程没回数：' + String(r.stderr || '').slice(-200))
  return JSON.parse(line)
}

const off = runArm(false)
const on = runArm(true)
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '-')
console.log(`题数 ${off.n}（盲测 + 标题抽样）`)
console.log(`关着：头名 ${off.hit}/${off.n} = ${pct(off.hit, off.n)}%`)
console.log(`开着：头名 ${on.hit}/${on.n} = ${pct(on.hit, on.n)}%`)
const delta = 100 * (on.hit - off.hit) / off.n
console.log(`差：${delta >= 0 ? '+' : ''}${delta.toFixed(1)} 个百分点`)
console.log(delta >= 1 ? '结论：值得训，可以排进后续。' : '结论：不值得训，保持默认关闭。')
