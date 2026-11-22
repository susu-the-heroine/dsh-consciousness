import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 学习重排：开与不开，头名差多少
 * ==============================
 *   node scripts/test-rerank.mjs
 *
 * 两个独立进程各跑一遍（模型模块有缓存，同一进程里切环境变量不生效——踩过）。
 * 打开后头名不该低于关掉，且要过 95%。
 * 注：模型用这批题训的，全量数偏乐观；可信的是训练脚本里的交叉验证（97.8%）。
 */
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

if (process.argv[2] === '--run') {
  const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
  const { searchTool } = await import(LIB + '/tools.js')
  const cases = (JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || [])
    .filter((c) => c && c.q && c.want)
  let hit = 0
  let n = 0
  for (const c of cases) {
    const r = await searchTool.execute({ query: c.q, limit: 5, review: false })
    let id = 0
    for (const line of String(r.log || '').split('\n')) {
      const m = line.match(/^· #(\d+)/)
      if (m) { id = Number(m[1]); break }
    }
    if (!id) continue
    n++
    if (id === Number(c.want)) hit++
  }
  console.log(JSON.stringify({ hit, n }))
  process.exit(0)
}

// 2026-11-19：两个进程原来共用一个 HOME，后跑的那个会读前一个留下的索引与缓存，
// 量出来的差值里混着状态差异。改成各给一个临时 HOME，把 main 海拷进去，跑完删掉。
const REAL_HOME = process.env.USERPROFILE || homedir()
const SRC_SEA = join(REAL_HOME, '.dsh', 'consciousness-seas', 'main')

const run = (on) => {
  if (!existsSync(SRC_SEA)) throw new Error('找不到 main 海：' + SRC_SEA)
  const tmp = mkdtempSync(join(tmpdir(), 'rerank-'))
  const seas = join(tmp, '.dsh', 'consciousness-seas')
  mkdirSync(seas, { recursive: true })
  cpSync(SRC_SEA, join(seas, 'main'), { recursive: true })
  try {
    const res = spawnSync(_nodeBin, [SELF, '--run'], {
      env: { ...process.env, USERPROFILE: tmp, HOME: tmp, C2_RERANK_MODEL: on ? '1' : '0' },
      encoding: 'utf8',
      timeout: 600000,
    })
    const line = String(res.stdout || '').trim().split('\n').filter((x) => x.startsWith('{')).pop()
    if (!line) throw new Error('子进程没回数：' + String(res.stderr || '').slice(-300))
    return JSON.parse(line)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const off = run(false)
const on = run(true)
const rOff = off.n ? off.hit / off.n : 0
const rOn = on.n ? on.hit / on.n : 0

console.log(`关：${off.hit}/${off.n} = ${(rOff * 100).toFixed(1)}%`)
console.log(`开：${on.hit}/${on.n} = ${(rOn * 100).toFixed(1)}%`)

ok('开了不比关掉差', rOn >= rOff - 0.005, `${(rOff * 100).toFixed(1)}% → ${(rOn * 100).toFixed(1)}%`)
// 2026-11-19：原来这条写死 95%，那是"共用 HOME、第二次读到热索引"时的数。
// 改成两个独立临时库之后复现不出 95：干净库里关 93.x、开 94.x。
// 所以绝对线降到 93，主判据是"开了不比关掉差"。
ok('开了至少 93%', rOn >= 0.93, (rOn * 100).toFixed(1) + '%')
ok('样本不少于三百', on.n >= 300, String(on.n))

console.log(`\n重排自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
