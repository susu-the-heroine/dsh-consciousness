/**
 * 时间仿真：只推时间，不造假对话。
 *
 * 问的是一个具体问题：放着不管，三十天、九十天以后，库里还剩什么。
 *
 * 三条死规矩：
 * 一、只读真的库，写只写沙箱（~/.dsh/consciousness-sim/），绝不碰本体。
 * 二、衰减用现成的 decayOf / rawDecayOf，不另写一套——另写就等于测我自己的算法。
 * 三、跑出来的结论要落盘，不能只打在屏幕上。
 *
 * 用法：node scripts/sim-time.mjs [天数...]
 * 默认跑 7 / 30 / 90 / 365 天。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decayOf, rawDecayOf } from '../lib/decay.js'
import { isSetting } from '../lib/kinds.js'

const D = join(homedir(), '.dsh')
const SEA = join(D, 'consciousness-seas', 'main', 'data.json')
const OUT = join(D, 'consciousness-sim')
const DAY = 86400000

const checkpoints = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0)
const days = checkpoints.length ? checkpoints.sort((a, b) => a - b) : [7, 30, 90, 365]

if (!existsSync(SEA)) {
  console.error('找不到识海本体：' + SEA)
  process.exit(2)
}

const raw = JSON.parse(readFileSync(SEA, 'utf8').replace(/^\uFEFF/, ''))
const pts = (raw.points || []).filter((p) => !p.dead)
const now = Date.now()

console.log('时间仿真（只读，不改库）')
console.log('起点：' + pts.length + ' 条记忆，' + (raw.edges || []).length + ' 条突触')

const rows = []
for (const d of days) {
  const t = now + d * DAY
  let bright = 0      // 显示上还亮（>=0.3）
  let faint = 0       // 暗（0.06~0.3）
  let gone = 0        // 真实可提取度 < 0.15，该归档了
  let forever = 0     // 底子/里程碑，不衰减
  let openAlive = 0

  for (const p of pts) {
    const eternal = isSetting(p) || p.gold
    if (eternal) forever++
    const shown = decayOf(p, t)
    const real = rawDecayOf(p, t)
    if (shown >= 0.3) bright++
    else if (shown > 0.06) faint++
    if (real < 0.15) gone++
    // 悬着的事不管是不是永不衰减，都算一次：之前这里被 continue 跳过，结果永远是 0
    if (p.open === true && real >= 0.15) openAlive++
  }

  const row = {
    day: d,
    total: pts.length,
    bright,
    faint,
    gone,
    forever,
    open: pts.filter((p) => p.open === true).length,
    openAlive,
  }
  rows.push(row)

  console.log(
    '第 ' + String(d).padStart(4) + ' 天：' +
    '还亮 ' + String(bright).padStart(4) +
    ' · 变暗 ' + String(faint).padStart(4) +
    ' · 该归档 ' + String(gone).padStart(4) +
    ' · 永不衰减 ' + String(forever).padStart(3) +
    ' · 悬着还能想起 ' + openAlive + '/' + row.open
  )
}

// 结论：只看两条会不会出问题
const last = rows[rows.length - 1]
const findings = []
if (last && last.gone > last.total * 0.6) {
  findings.push('到期时 ' + last.gone + '/' + last.total + ' 条已低于归档线：库会空，需要提高基线或降衰减')
}
if (last && last.open > 0 && last.openAlive === 0) {
  findings.push('悬着的事全部沉到底：写着"还没完"的东西也会被忘，说明悬挂状态没有保护')
}
if (last && last.forever > last.total * 0.7) {
  findings.push('永不衰减 ' + last.forever + '/' + last.total + ' 条：底子类太多，衰减基本没在工作')
}
if (rows.length >= 2) {
  const first = rows[0]
  if (last.bright === first.bright && last.gone === first.gone) {
    findings.push('前后一模一样：衰减可能根本没生效（或者全是永不衰减的那几类）')
  }
}

mkdirSync(OUT, { recursive: true })
const out = { at: now, sea: SEA, checkpoints, rows, findings }
writeFileSync(join(OUT, 'last.json'), JSON.stringify(out, null, 1), 'utf8')

console.log('')
if (findings.length) {
  console.log('发现 ' + findings.length + ' 条：')
  for (const f of findings) console.log('  · ' + f)
} else {
  console.log('没发现异常（这不等于对，只等于这几个数没越界）')
}
console.log('结果已落盘：' + join(OUT, 'last.json'))

// 结论也写进工厂：真库的结果单独一页，跟沙箱那份分开，别互相覆盖。
try {
  const FACTORY = process.env.SHIOHAI_FACTORY || 'C:\\Users\\Administrator\\Desktop\\识海工厂_2026-11-07'
  if (existsSync(FACTORY)) {
    const md = [
      '# 仿真结果 · 真库（自动写，别手改）',
      '',
      '> 由 `sim-time.mjs` 覆写。这份是真库，全是底子和里程碑，**不能代表普通用户**。',
      '',
      '时间：' + new Date(now).toLocaleString('zh-CN') + '　起点：' + pts.length + ' 条',
      '',
      '| 天 | 还亮 | 变暗 | 该归档 | 免衰减 | 悬着还能想起 |',
      '|---|---|---|---|---|---|',
      ...rows.map((r) => '| ' + r.day + ' | ' + r.bright + ' | ' + r.faint + ' | ' + r.gone + ' | ' + r.forever + ' | ' + r.openAlive + '/' + r.open + ' |'),
      '',
      findings.length ? '## 结论\n\n' + findings.map((f) => '- ' + f).join('\n') : '## 结论\n\n没越界。',
      '',
      '**注意**：这份库七成以上是底子（永不衰减），跑出来"全亮"是正常的，不代表系统不会忘。要看真实分布，用沙箱那份 `sim-corpus.mjs`。',
      '',
    ].join('\n')
    writeFileSync(join(FACTORY, '仿真结果_真库.md'), md, 'utf8')
    console.log('已写进工厂：仿真结果_真库.md')
  }
} catch (e) {
  console.log('写工厂失败（不影响结论）：' + (e && e.message))
}
