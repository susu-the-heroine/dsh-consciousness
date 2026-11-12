/**
 * 对照库：造一个"普通用户"的识海，看衰减在真实分布下会不会干活。
 *
 * 为什么要在沙箱造：咱们这个库里一百七十五条约一百四十一条是底子和里程碑，
 * 全是免死金牌，衰减永远测不出东西。要问"别人装上会怎样"，
 * 就得有一份八成琐事的库。
 *
 * 规矩：只在 ~/.dsh/consciousness-sim/ 里造，绝不写进真库。
 *
 * 用法：node scripts/sim-corpus.mjs [条数] [天数...]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decayOf, rawDecayOf } from '../lib/decay.js'
import { isSetting } from '../lib/kinds.js'

const D = join(homedir(), '.dsh')
const OUT = join(D, 'consciousness-sim')
mkdirSync(OUT, { recursive: true })

const n = Number(process.argv[2]) || 300
const checkpoints = process.argv.slice(3).map(Number).filter((x) => x > 0)
const days = checkpoints.length ? checkpoints.sort((a, b) => a - b) : [7, 30, 90, 365]
const DAY = 86400000
const now = Date.now()

// 固定的伪随机：同一份种子每次结果一样，方便对比改动前后
let seed = 20261111
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

// 分布：75% 琐事（fact/feeling）、20% 里程碑（gold）、5% 底子（setting）
const pts = []
for (let i = 0; i < n; i++) {
  const r = rnd()
  const kind = r < 0.05 ? 'setting' : r < 0.25 ? 'gold' : (rnd() < 0.5 ? 'fact' : 'feeling')
  const born = now - Math.floor(rnd() * 180) * DAY   // 过去半年内陆续记的
  const arousal = Math.round(1 + rnd() * 9)
  const imp = Math.round(rnd() * 100) / 100
  pts.push({
    id: i + 1,
    title: kind + '-' + (i + 1),
    text: '合成样本',
    kind,
    gold: kind === 'gold',
    born,
    lastSeen: born,
    arousal,
    imp,
    strength: 10 + Math.round(rnd() * 60),
    open: rnd() < 0.05,
    dead: false,
  })
}

const dom = join(OUT, 'corpus.json')
writeFileSync(dom, JSON.stringify({ at: now, points: pts }, null, 1), 'utf8')

console.log('对照库（沙箱）：' + n + ' 条，八成琐事两成里程碑；已写到 ' + dom)
// 按真逻辑推进：每 30 天扫一次归档，两条腿都算——
// ① 相对：池子里最淡的 5%（池子 ≥50 条才动）
// ② 绝对：裸衰减 < 0.18
// 之前这脚本只算绝对，所以显示"零归档"；那不是系统的问题，是我漏了一条腿。
const archived = new Set()
const maxDay = days[days.length - 1]
// 上次跑的结果：用来对比"改了之后是好了还是坏了"
const basePath = join(OUT, 'corpus-result.json')
let prev = null
try { if (existsSync(basePath)) prev = JSON.parse(readFileSync(basePath, 'utf8')) } catch { prev = null }

const rows = []
let cursor = 0
for (let d = 0; d <= maxDay; d += 1) {
  const t = now + d * DAY
  const pool = pts.filter((p) => !archived.has(p.id) && !isSetting(p) && !p.gold)
  const today = []
  // 相对：最淡的 5%，且每天最多收 1 条（跟 archive.js 的两道闸一致）
  if (pool.length >= 50) {
    const sorted = pool.slice().sort((a, b) => rawDecayOf(a, t) - rawDecayOf(b, t))
    const cut = Math.max(1, Math.floor(sorted.length * 0.05))
    for (const p of sorted.slice(0, cut)) {
      if (rawDecayOf(p, t) < 0.9) today.push(p)
    }
  }
  // 绝对：真烂透了，优先级最高
  for (const p of pool) {
    if (rawDecayOf(p, t) < 0.18) today.push(p)
  }
  for (const p of today.slice(0, 1)) archived.add(p.id)

  while (cursor < days.length && days[cursor] <= d) {
    const dd = days[cursor]
    let bright = 0, faint = 0, gone = 0, forever = 0
    for (const p of pts) {
      const eternal = isSetting(p) || p.gold
      if (eternal) forever++
      if (archived.has(p.id)) { gone++; continue }
      const shown = decayOf(p, t)
      if (shown >= 0.3) bright++
      else if (shown > 0.06) faint++
    }
    rows.push({ day: dd, bright, faint, gone, forever, alive: pts.length - gone })
    console.log(
      '第 ' + String(dd).padStart(4) + ' 天：' +
      '还亮 ' + String(bright).padStart(4) +
      ' · 变暗 ' + String(faint).padStart(4) +
      ' · 已归档 ' + String(gone).padStart(4) +
      ' · 免衰减 ' + String(forever).padStart(4)
    )
    cursor++
  }
}

const findings = []
const last = rows[rows.length - 1]
const openTotal = pts.filter((p) => p.open).length
if (last && last.alive > n * 0.8) findings.push('一年后还有 ' + last.alive + '/' + n + ' 条活着：收得太慢，库会一直涨')
if (last && last.alive < n * 0.2) findings.push('一年后只剩 ' + last.alive + '/' + n + ' 条：收得太狠，普通用户会觉得它健忘')
if (openTotal && last && last.gone > 0) {
  // 看悬着的有没有被沉掉
  const t = now + last.day * DAY
  const sunkOpen = pts.filter((p) => p.open && rawDecayOf(p, t) < 0.15).length
  if (sunkOpen) findings.push('悬着的事沉了 ' + sunkOpen + '/' + openTotal + ' 条：写着没完的东西也会被忘')
}

// 跟上次比：只在同一天数上比，别拿 90 天跟 365 天比
if (prev && Array.isArray(prev.rows)) {
  console.log('')
  console.log('跟上次比：')
  let any = false
  for (const r of rows) {
    const p0 = prev.rows.find((x) => x.day === r.day)
    if (!p0) continue
    const dAlive = (r.alive ?? (r.bright + r.faint)) - (p0.alive ?? (p0.bright + p0.faint))
    const dGone = r.gone - p0.gone
    if (dAlive === 0 && dGone === 0) continue
    any = true
    console.log('  第 ' + r.day + ' 天：活着 ' + (dAlive > 0 ? '+' : '') + dAlive + ' · 归档 ' + (dGone > 0 ? '+' : '') + dGone)
  }
  if (!any) console.log('  和上次一模一样')
} else {
  console.log('')
  console.log('第一次跑，没有基线可比（这次的结果会当基线）')
}

const out = join(OUT, 'corpus-result.json')
writeFileSync(out, JSON.stringify({ at: now, n, rows, findings }, null, 1), 'utf8')
console.log('')
if (findings.length) {
  console.log('发现 ' + findings.length + ' 条：')
  for (const f of findings) console.log('  · ' + f)
} else {
  console.log('这个分布下没发现越界')
}
console.log('结果：' + out)

// 闭环：把结论写进工厂，不用人手动抄。
// 工厂不在就当没这回事，别报错——别人机器上没这个目录。
try {
  const FACTORY = process.env.SHIOHAI_FACTORY || 'C:\\Users\\Administrator\\Desktop\\识海工厂_2026-11-07'
  if (existsSync(FACTORY)) {
    const md = [
      '# 仿真结果（自动写，别手改）',
      '',
      '> 这页由 `sim-corpus.mjs` 每次跑完覆写。看结论看最后一段。',
      '',
      '时间：' + new Date(now).toLocaleString('zh-CN') + '　样本：' + n + ' 条（八成琐事）',
      '',
      '| 天 | 还亮 | 变暗 | 已归档 | 免衰减 |',
      '|---|---|---|---|---|',
      ...rows.map((r) => '| ' + r.day + ' | ' + r.bright + ' | ' + r.faint + ' | ' + r.gone + ' | ' + r.forever + ' |'),
      '',
      findings.length ? '## 结论\n\n' + findings.map((f) => '- ' + f).join('\n') : '## 结论\n\n这个分布下没有越界。**不等于对，只等于这几个数没超线。**',
      '',
    ].join('\n')
    writeFileSync(join(FACTORY, '仿真结果.md'), md, 'utf8')
    console.log('已写进工厂：仿真结果.md')
  }
} catch (e) {
  console.log('写工厂失败（不影响结论）：' + (e && e.message))
}
