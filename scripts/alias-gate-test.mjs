import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 别名四道闸的正反验证
 * ====================
 *
 *   node scripts/alias-gate-test.mjs
 *
 * 造三组假日志，喂给 alias-learn2：
 *   正例：同一句、三次、跨三天 → 必须出 1 条候选
 *   反例一：同一句、三次、都在同一天 → 必须 0 条
 *   反例二：同一句、只有两次、跨三天 → 必须 0 条
 *
 * 为什么要有这个：闸"空着"和闸"坏了"看起来一样。
 * 2026-11-14 夜写过一版生成器，一口气吐六十九条模板别名——那次就是没有闸。
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const D = join(homedir(), '.dsh')
const sea = 'sandbox'
const dataPath = join(D, 'consciousness-seas', sea, 'data.json')
// 2026-11-21：没有沙箱海时它打印「跳过」然后退出码零——一道闸门测试，
// 什么都没测却报通过，比红着更糟。改成「没测到」也红（退出码二）。
if (!existsSync(dataPath)) {
  console.log('沙箱海不在，这轮没测到——不算通过。')
  console.log('先建一个 sandbox 海再跑：' + dataPath)
  process.exit(2)
}
const pts = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, '')).points || []
if (!pts.length) {
  console.log('沙箱海是空的，这轮没测到——不算通过。')
  process.exit(2)
}
const target = Number(pts[0].id)

const now = Date.now()
const day = 86400000
const row = (at, q) => JSON.stringify({ at, sea, q, core: [], rel: [target], relScore: [[target, 10, 0.8, 3]] })

const cases = [
  { name: '正例（三次跨三天）', lines: [row(now - 2 * day, '这台机器上次是怎么坏的'), row(now - day, '这台机器上次是怎么坏的'), row(now, '这台机器上次是怎么坏的')], want: 1 },
  { name: '反例一（三次同一天）', lines: [row(now - 3600000, '那句话到底啥意思呢'), row(now - 3000000, '那句话到底啥意思呢'), row(now - 2400000, '那句话到底啥意思呢')], want: 0 },
  { name: '反例二（只问过两次）', lines: [row(now - 2 * day, '只问过两遍的那句话呀'), row(now, '只问过两遍的那句话呀')], want: 0 },
]

const logPath = join(D, 'alias-gate-test-log.jsonl')
let bad = 0
for (const c of cases) {
  writeFileSync(logPath, c.lines.join('\n') + '\n', 'utf8')
  const r = spawnSync(_nodeBin, [join(HERE, 'alias-learn2.mjs'), sea], {
    encoding: 'utf8',
    env: { ...process.env, DSH_PICK_LOG: logPath },
    timeout: 120000,
  })
  const m = /候选 (\d+) 条/.exec(String(r.stdout || ''))
  const got = m ? Number(m[1]) : -1
  const ok = got === c.want
  if (!ok) bad++
  console.log(`${ok ? '过' : '挂'}  ${c.name}：要 ${c.want} 条，出 ${got} 条`)
}

try { unlinkSync(logPath) } catch {}
try { rmSync(join(D, 'consciousness-alias-candidates2.md'), { force: true }) } catch {}

console.log(bad === 0 ? '四道闸正反都对。' : `有 ${bad} 组不对。`)
process.exit(bad === 0 ? 0 : 1)
