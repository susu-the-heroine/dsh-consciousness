import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 幽灵拒答开关：打开有效，默认不响
 * ==============================
 *
 *   node scripts/ghost-test.mjs
 *
 * 验三件：
 *   1. 开关设 0 时回到旧行为（不拒任何一条）
 *   2. 默认（不设）时，六件假事里至少四件说"没记过"
 *   3. 开关打开时，真记得的问题不许被误拒
 *
 * 做法：起两个子进程，一个带开关一个不带，避免同进程里环境变量互相污染。
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE = _nodeBin
const RUN = join(HERE, 'ghost-run.mjs')

// 2026-11-21：原来验「默认（不设）」那条，传的是空字符串——那是「设了但为空」，
// 不是「没设」。现在两者恰好同一条路（代码里判断的是等于「0」才关），
// 可哪天有人改成「空就算关」，这行就会悄悄测错分支。不设就真不设。
const run = (env, drop = []) => {
  const e = { ...process.env, ...env }
  for (const k of drop) delete e[k]
  const r = spawnSync(NODE, [RUN], { env: e, encoding: 'utf8', maxBuffer: 1e8 })
  const line = String(r.stdout || '').trim().split(/\r?\n/).pop() || ''
  try { return JSON.parse(line) } catch { return { bad: true, raw: line + String(r.stderr || '').slice(0, 200) } }
}

let bad = 0
const off = run({ C2_GHOST_REFUSE: '0' })
if (off.bad) { bad++; console.log('挂  开关关着时跑不起来：' + off.raw) }
else if (off.fakeRefused !== 0) { bad++; console.log(`挂  开关关着却拒了 ${off.fakeRefused} 条假事（不该动）`) }
else console.log('过  开关关着：不拒任何一条，保持原样')

const on = run({}, ['C2_GHOST_REFUSE'])
if (on.bad) { bad++; console.log('挂  开关打开跑不起来：' + on.raw) }
else {
  if (on.fakeRefused < 4) { bad++; console.log(`挂  打开只拒了 ${on.fakeRefused}/6 条假事（要 ≥4）`) }
  else console.log(`过  打开：假事拒了 ${on.fakeRefused}/6`)
  if (on.realRefused !== 0) { bad++; console.log(`挂  打开后误拒真问题 ${on.realRefused} 条`) }
  else console.log('过  打开：真问题一条没误拒')
}

console.log(bad ? `不对：${bad} 处。` : '幽灵拒答：开关有效、默认不响。')
process.exit(bad ? 1 : 0)
