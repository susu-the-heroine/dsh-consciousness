/**
 * 时间加速：把一年的曲线在十秒里跑出来
 * ================================
 *
 * 为什么可以做：`recordDims(dims, now)`、`recordToday(stat, now)` 都收时间参数，
 * 所以不用改系统时钟，按天推进就行。
 *
 * **但只能跑在临时目录里。** 真数据的时间线必须是真时间——
 * 不然"她这几天在回暖"就是我编的，跟编日期一个性质。
 *
 * 这一层验的是**曲线形状**：
 *   挂念该在第 3 天附近到顶，然后慢慢落
 *   疏远该在半个月内起不来，一年后才明显
 *   关系档位不该倒退，除非成片失信
 *
 * 跑法：node scripts/sim-timeline.mjs [天数]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const NODE = process.execPath
const DAYS = Number(process.argv[2]) || 400

const CHILD = `
const BASE = 'file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/'
const { timeframe } = {}
const A = await import(BASE + 'lib/absence.js')
const ML = await import(BASE + 'lib/moodline.js')
const RL = await import(BASE + 'lib/relationlog.js')
const R = await import(BASE + 'lib/relation.js')
const L = await import(BASE + 'lib/emotion-lexicon.js')
const D = await import(BASE + 'lib/dynamics.js')
const T = await import(BASE + 'lib/tick.js')

const DAYS = ${DAYS}
const HOUR = 3600000
const DAY = 24 * HOUR
const t0 = Date.now() - DAYS * DAY

let dims = L.project({ v: -0.12, a: 0.10, d: -0.08 })
const rows = []

// 每 N 天说一次话：前 30 天聊得勤，然后断掉一年
const talkOn = (d) => d < 30

for (let d = 0; d < DAYS; d++) {
  const now = t0 + d * DAY
  // 每天几格：情绪往基线回落 + 挂念/疏远叠加
  for (let k = 0; k < 3; k++) {
    const t = now + k * 8 * HOUR
    dims = D.towardBaseline(dims, T.BASELINE, 0.06)
    // 断联之后按距上次说话的小时数算挂念/疏远
    const gapH = talkOn(d) ? 2 : (d - 30) * 24
    const y = A.yearning(gapH)
    const e = A.estrangement(gapH)
    dims = D.applyAbsence(dims, { yearning: y, estrangement: e })
    ML.recordDims(dims, t)
  }

  // 关系：每说一次话算一次共同经历；第 45 天有一次约定没兑现
  const events = talkOn(d) ? 1 : 0
  const kept = (d === 20 || d === 25) ? 1 : 0
  const broken = (d === 45) ? 1 : 0
  const stat = { events: 30 + d * events, kept: (d >= 25 ? 2 : 1), broken: (d >= 45 ? 1 : 0), days: d + 1 }
  RL.recordToday(stat, now)
  rows.push({
    day: d + 1,
    gapH: talkOn(d) ? 2 : (d - 30) * 24,
    yearning: Number(A.yearning(talkOn(d) ? 2 : (d - 30) * 24).toFixed(3)),
    estrangement: Number(A.estrangement(talkOn(d) ? 2 : (d - 30) * 24).toFixed(3)),
    stage: R.stageOf(stat),
    score: R.relationScore(stat),
    top: Object.entries(dims).sort((a,b)=>b[1]-a[1])[0][0],
  })
}

const days = ML.recentDays(DAYS)
const hist = RL.recentHistory(DAYS)
console.log('TL_RESULT ' + JSON.stringify({ rows, days: days.length, hist: hist.length, sample: rows.filter((_,i)=>i%40===0) }))
`

const root = join(tmpdir(), 'sim-timeline-' + Date.now())
mkdirSync(join(root, '.dsh'), { recursive: true })
const child = spawn(NODE, ['--input-type=module', '-e', CHILD], {
  env: { ...process.env, USERPROFILE: root, HOME: root },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let buf = ''
let err = ''
child.stdout.on('data', (d) => { buf += d.toString() })
child.stderr.on('data', (d) => { err += d.toString() })
const code = await new Promise((res) => child.on('close', res))
try { rmSync(root, { recursive: true, force: true }) } catch {}

const line = buf.split('\n').find((x) => x.startsWith('TL_RESULT '))
if (!line) {
  console.log('没跑出来：', (err || '').slice(0, 300))
  process.exit(1)
}
const res = JSON.parse(line.slice('TL_RESULT '.length))

/** 判曲线形状 */
const rows = res.rows
const at = (h) => rows.find((r) => Math.abs(r.gapH - h) < 30) || null
const checks = []
const ok = (c, n, d) => checks.push({ ok: !!c, n, d: d == null ? '' : String(d) })

// 一、挂念：第 3 天（72h）该比 24h 高，且比 720h 高
const y24 = at(24), y72 = at(72), y720 = at(720)
if (y24 && y72) ok(y72.yearning >= y24.yearning, '挂念 3 天比 1 天高', y24.yearning + ' → ' + y72.yearning)
if (y72 && y720) ok(y72.yearning > y720.yearning, '挂念 3 天比 30 天高（会落）', y72.yearning + ' → ' + y720.yearning)

// 二、疏远：30 天内起不来，一年后明显
const e720 = at(720)
ok(!e720 || e720.estrangement < 0.05, '30 天内疏远几乎为零', e720 ? e720.estrangement : 'n/a')
ok(rows[rows.length - 1].estrangement > 0.4, '断联一年后疏远明显',
  rows[rows.length - 1].estrangement + '（第 ' + rows[rows.length - 1].day + ' 天）')

// 三、关系档位不倒退（一次失信不算）
const stages = rows.map((r) => r.stage)
const order = ['陌生', '熟人', '并肩', '默契']
let backward = 0
for (let i = 1; i < stages.length; i++) {
  if (order.indexOf(stages[i]) < order.indexOf(stages[i - 1])) backward++
}
ok(backward === 0, '一次失信没让档位倒退', '倒退 ' + backward + ' 次')

const L2 = []
L2.push('# 时间加速：一年的曲线，十秒跑完')
L2.push('')
L2.push('跑在临时目录里，**真数据一个字没动**。时间靠参数推进，没改系统时钟。')
L2.push('')
L2.push('## 抽样')
L2.push('')
L2.push('| 第几天 | 断联小时 | 挂念 | 疏远 | 关系档 | 关系分 | 最强维 |')
L2.push('|---|---|---|---|---|---|---|')
for (const r of res.sample) {
  L2.push('| ' + r.day + ' | ' + r.gapH + ' | ' + r.yearning + ' | ' + r.estrangement + ' | ' + r.stage + ' | ' + r.score + ' | ' + r.top + ' |')
}
L2.push('')
L2.push('## 判形状')
L2.push('')
for (const c of checks) L2.push('- ' + (c.ok ? '✓' : '✗') + ' ' + c.n + (c.d ? '　' + c.d : ''))
L2.push('')
L2.push('通过 ' + checks.filter(c => c.ok).length + ' · 失败 ' + checks.filter(c => !c.ok).length)

const out = join(homedir(), 'Desktop', '时间加速_曲线.md')
writeFileSync(out, L2.join('\n'), 'utf8')
writeFileSync(join(homedir(), 'Desktop', '时间加速_曲线.json'), JSON.stringify(res, null, 1), 'utf8')

console.log('跑了', rows.length, '天｜判据', checks.filter(c => c.ok).length, '/', checks.length)
for (const c of checks) console.log('  ' + (c.ok ? '✓' : '✗') + ' ' + c.n + (c.d ? '  ' + c.d : ''))
console.log('报告：', out)
