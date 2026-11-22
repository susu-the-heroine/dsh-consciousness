/**
 * 人格一致率：两批回复是不是同一个人在说话
 * ==========================================
 *   node scripts/persona-drift.mjs <A文件> <B文件>
 *
 * 不比字面、不比"像不像谁"，只比七项分布：
 *   1 中位句长   2 P90 句长   3 否定句比例   4 命令句比例
 *   5 问句比例   6 口头禅命中率（大肥鱼那几句常说的）   7 破句率（结尾无标点）
 *
 * 每项先算两边的差，再按各自的容忍带归一（句长 ±4、比例 ±0.15），
 * 七项取平均得到 0–100 的一致率。90 以上算同一个人，70–90 算漂了，70 以下算不像同一个人。
 */
import { readFileSync, existsSync } from 'node:fs'

const TICKS = ['卧槽', '大魔王', '硬是要得', '行吧', '别', '拉倒', '我认', '懂了', '操', '靠']
const clean = (t) => String(t).replace(/^\d+\.\s*/, '').trim()

function stats(lines) {
  const lens = []
  let neg = 0, imp = 0, q = 0, tick = 0, broken = 0
  for (const raw of lines) {
    const t = clean(raw)
    if (!t) continue
    lens.push([...t].length)
    if (/不|没|别|甭|莫/.test(t)) neg++
    if (/^(去|先|直接|赶紧|别|把|给我|上|停|撤)/.test(t)) imp++
    if (/[？?]$|吗$|呢$|吧$/.test(t)) q++
    if (TICKS.some((k) => t.includes(k))) tick++
    if (!/[。！？!?…~～]$/.test(t)) broken++
  }
  lens.sort((a, b) => a - b)
  const n = lens.length || 1
  const longRate = lens.filter((x) => x > 25).length / n
  return {
    n,
    med: lens[Math.floor(n / 2)] || 0,
    p90: lens[Math.floor(n * 0.9)] || 0,
    longRate,
    neg: neg / n, imp: imp / n, q: q / n, tick: tick / n, broken: broken / n,
  }
}

const band = (diff, tol) => Math.max(0, 1 - diff / tol)

const [, , fa, fb] = process.argv
if (!fa || !fb || !existsSync(fa) || !existsSync(fb)) {
  console.log('  用法：node scripts/persona-drift.mjs <A文件> <B文件>')
  process.exit(1)
}
// 支持编号集，也支持裸文本（一行一句）；没编号就按非空行算
const grab = (f) => {
  const raw = readFileSync(f, 'utf8')
  const numbered = raw.split('\n').filter((l) => /^\d+\. /.test(l))
  if (numbered.length) return numbered
  return raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
}
const A = stats(grab(fa))
const B = stats(grab(fb))

// 比例项的容忍带随样本量走：n=10 时每差一条就是 0.1，带宽必须放大到 2/n
const tolRatio = Math.max(0.15, 2 / Math.min(A.n, B.n))
const rows = [
  ['中位句长', A.med, B.med, band(Math.abs(A.med - B.med), 4)],
  ['长句率(>25字)', A.longRate.toFixed(2), B.longRate.toFixed(2), band(Math.abs(A.longRate - B.longRate), tolRatio)],
  ['否定句', A.neg.toFixed(2), B.neg.toFixed(2), band(Math.abs(A.neg - B.neg), tolRatio)],
  ['命令句', A.imp.toFixed(2), B.imp.toFixed(2), band(Math.abs(A.imp - B.imp), tolRatio)],
  ['问句', A.q.toFixed(2), B.q.toFixed(2), band(Math.abs(A.q - B.q), tolRatio)],
  ['口头禅', A.tick.toFixed(2), B.tick.toFixed(2), band(Math.abs(A.tick - B.tick), tolRatio)],
  // 破句率已从评分里拿掉：它量的是「句末不点标点」，那条规矩作废了。留着只当信息看。
]
console.log('  项          A      B     一致')
for (const r of rows) console.log('  ' + String(r[0]).padEnd(10) + String(r[1]).padEnd(7) + String(r[2]).padEnd(7) + (r[3] * 100).toFixed(0) + '%')
const score = rows.reduce((s, r) => s + r[3], 0) / rows.length * 100
console.log('  人格一致率：' + score.toFixed(0) + '（90 以上同一个人 · 70 以下不像）')
