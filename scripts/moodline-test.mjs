/**
 * 情绪线自测
 * ========
 *   node scripts/moodline-test.mjs
 *
 * 盯四件事：
 *   1) 当天多次采样取的是滚动平均，不是最后一次覆盖；
 *   2) 当天序列最多留 72 个点（画图用，文件不能无限涨）；
 *   3) 超过一年（365 天）的旧日子会被裁掉；
 *   4) 文件写坏了不抛错，读出来是空的，别把内观页拖崩。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库里那两处按当前目录拼路径，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'mood-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const ML = await import('file:///' + join(HERE, '..', 'lib', 'moodline.js').replace(/\\/g, '/'))
const FILE = ML.linePath()

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }

const now = Date.now()
// 1) 滚动平均：calm 三次 1 / 0.5 / 0 → 0.5
ML.recordDims({ calm: 1, flutter: 0, lonely: 0, weary: 0 }, now)
ML.recordDims({ calm: 0.5, flutter: 0, lonely: 0, weary: 0 }, now)
ML.recordDims({ calm: 0, flutter: 0, lonely: 0, weary: 0 }, now)
const line = ML.readLine()
const days = Object.keys(line.days || {})
const today = line.days[days[0]] || {}
ok('当天有记录', days.length === 1, days[0])
ok('滚动平均算对了（0.5）', Math.abs(Number(today.avg.calm) - 0.5) < 0.01, String(today.avg.calm))
ok('采样数记成 3', Number(today.n) === 3, String(today.n))

// 1b) 越界的维度要被夹住（2026-11-20 补）
{
  const t2 = mkdtempSync(join(tmpdir(), 'mood-clamp-'))
  const homeOld = process.env.USERPROFILE
  process.env.USERPROFILE = t2
  process.env.HOME = t2
  mkdirSync(join(t2, '.dsh'), { recursive: true })
  const ML2 = await import('file:///' + join(HERE, '..', 'lib', 'moodline.js').replace(/\\/g, '/') + '?v=' + Date.now())
  ML2.recordDims({ calm: 5, flutter: -3, lonely: 0, weary: 0 }, Date.now())
  const l2 = ML2.readLine()
  const d2 = l2.days[Object.keys(l2.days)[0]] || {}
  ok('越界的维度被夹到 0~1（均值）', Number(d2.avg.calm) <= 1 && Number(d2.avg.flutter) >= 0, `calm=${d2.avg.calm} flutter=${d2.avg.flutter}`)
  ok('峰值也被夹到 0~1', !d2.peak || Number(d2.peak.v) <= 1, JSON.stringify(d2.peak))
  process.env.USERPROFILE = homeOld
  try { rmSync(t2, { recursive: true, force: true }) } catch {}
}

// 2) 序列封顶 72
for (let i = 0; i < 100; i++) ML.recordDims({ calm: 1, flutter: 0, lonely: 0, weary: 0 }, now)
const l2 = ML.readLine()
const t2 = l2.days[Object.keys(l2.days)[0]]
ok('当天序列封顶 72 个点', Array.isArray(t2.series) && t2.series.length === 72, String(t2.series && t2.series.length))

// 3) 旧日子被裁掉：塞一个两年前的日子，再记一次
{
  // 2026-11-21：这里原来在 ESM 里用 require，每次跑都抛 ReferenceError 被 catch 接住，
  // 靠兜底那一支干活——能跑，但每次都在吞一个错。改成直接用上面已经引入的读文件。
  const raw = JSON.parse(readFileSync(FILE, 'utf8'))
  raw.days['2024-01-01'] = { n: 1, avg: { calm: 1 }, peak: null, peakAt: 0 }
  writeFileSync(FILE, JSON.stringify(raw), 'utf8')
}
ML.recordDims({ calm: 1, flutter: 0, lonely: 0, weary: 0 }, now)
const l3 = ML.readLine()
ok('两年前的旧日子被裁掉', !l3.days['2024-01-01'])

// 4) 坏文件不崩
writeFileSync(FILE, '{坏掉的', 'utf8')
const l4 = ML.readLine()
ok('写坏了读出来是空的，不抛错', !l4.days || Object.keys(l4.days).length === 0)

console.log(`\n情绪线自测：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
