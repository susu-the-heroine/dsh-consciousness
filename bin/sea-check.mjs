#!/usr/bin/env node
/**
 * sea-check —— 装完就能跑的自检（给别人用的）
 * ==========================================
 *   sea-check                      看用法
 *   sea-check 我的回复.md           扫腔，和插件运行时同一把尺子
 *   sea-check A.md B.md            比人格一致率（同一套题的两批答）
 *   sea-check --rules              列出在查哪几条
 *
 * 关键：规则不另写一套，直接 import ../lib/aiflavor.js——
 * 插件每轮回看用的就是它，口径只有一份，改一处两边一起变。
 *
 * 不含任何人的私人记忆，也不读识海库；只读你给的文件。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { aiflavor, flavorLine } from '../lib/aiflavor.js'

const KINDS = ['定义腔', '列举腔', '总结腔', '解释腔', '空话腔', '元话语', '判断腔', '冒号断言', '定性腔', '排比腔', '空转腔']
const BAD = 0.35 // 与 lib/replycheck.js 同一个阈值

function lines(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => l.replace(/^\d+[.、]\s*/, '').trim())
}

function smell(file) {
  const arr = lines(file)
  let bad = 0
  const byKind = {}
  for (const t of arr) {
    const r = aiflavor(t)
    if (r.score >= BAD) bad++
    for (const k of r.kinds) byKind[k] = (byKind[k] || 0) + 1
  }
  const n = arr.length || 1
  console.log('  ' + file + '：' + arr.length + ' 条 · 判有腔 ' + bad + '（' + Math.round(bad / n * 100) + '%）· 阈值 ' + BAD)
  for (const [k, v] of Object.entries(byKind)) console.log('    ' + k + ' ×' + v)
  if (!Object.keys(byKind).length) console.log('    （一条腔都没抓到）')
  return { n, bad }
}

function metrics(file) {
  const arr = lines(file)
  const lens = arr.map((t) => [...t].length).sort((a, b) => a - b)
  const med = lens[Math.floor(lens.length / 2)] || 0
  const long = arr.filter((t) => [...t].length > 25).length / (arr.length || 1)
  const neg = arr.filter((t) => /[不没别甭勿]/.test(t)).length / (arr.length || 1)
  const cmd = arr.filter((t) => /^(别|去|赶紧|直接|先|把|给我|不要)/.test(t)).length / (arr.length || 1)
  const ask = arr.filter((t) => /[？?]$/.test(t)).length / (arr.length || 1)
  const tic = arr.filter((t) => /(卧槽|他妈的|硬是要得|服个屁)/.test(t)).length / (arr.length || 1)
  return { n: arr.length, med, long, neg, cmd, ask, tic }
}

function drift(a, b) {
  const A = metrics(a), B = metrics(b)
  if (A.n !== B.n) {
    console.log('  两批条数不一样（' + A.n + ' vs ' + B.n + '），先凑齐再比，不然分数没意义')
    return
  }
  const band = (d) => Math.max(0, 100 - Math.min(100, d * 100))
  const items = [
    ['中位句长', Math.abs(A.med - B.med) / Math.max(A.med, B.med, 1)],
    ['长句率', Math.abs(A.long - B.long)],
    ['否定句', Math.abs(A.neg - B.neg)],
    ['命令句', Math.abs(A.cmd - B.cmd)],
    ['问句', Math.abs(A.ask - B.ask)],
    ['口头禅', Math.abs(A.tic - B.tic)],
  ]
  const score = Math.round(items.reduce((s, [, d]) => s + band(d), 0) / items.length)
  console.log('  人格一致率：' + score + '（90 以上同一个人 · 70 以下不像）')
  for (const [k, d] of items) console.log('    ' + k + ' 差 ' + d.toFixed(2))
}

function trend() {
  const log = join(homedir(), '.dsh', 'consciousness-flavor-log.jsonl')
  if (!existsSync(log)) { console.log('  还没有日志：' + log + '\n  跑几轮对话再来看。'); return }
  const rows = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const judged = rows.filter((r) => typeof r.score === 'number')
  const retries = rows.filter((r) => r.retry).length
  if (!judged.length) { console.log('  日志里还没有判定行。'); return }
  const byDay = {}
  for (const r of judged) {
    const d = new Date(r.at).toISOString().slice(0, 10)
    const o = byDay[d] || { n: 0, bad: 0 }
    o.n++; o.bad += Number(r.bad) || 0
    byDay[d] = o
  }
  const days = Object.keys(byDay).sort()
  console.log('  共 ' + judged.length + ' 轮判定 · 判有腔 ' + judged.filter((r) => Number(r.bad)).length + ' 轮 · 重说 ' + retries + ' 次')
  for (const d of days) {
    const o = byDay[d]
    console.log('    ' + d + '：' + o.n + ' 轮，有腔 ' + o.bad + '（' + Math.round(o.bad / o.n * 100) + '%）')
  }
  // 对基线、对上次
  const base = join(homedir(), '.dsh', 'consciousness-baseline.json')
  try {
    if (existsSync(base)) {
      const b = JSON.parse(readFileSync(base, 'utf8'))
      const lastRow = judged[judged.length - 1]
      const avgBad = judged.reduce((s, r) => s + (Number(r.bad) ? 1 : 0), 0) / judged.length
      console.log('  对基线：基线均分为 ' + Number(b.score).toFixed(2) + '（' + new Date(b.at).toISOString().slice(0, 10) + ' 立的）；现在有腔率 ' + Math.round(avgBad * 100) + '%')
      console.log('  对上次：上一轮分数 ' + Number(lastRow.score).toFixed(2) + '，' + (avgBad === 0 ? '最近这段都干净' : '最近有中招'))
    } else {
      console.log('  还没有基线：下一轮判定会自动写一条，之后这里会显示「对基线」的数。')
    }
  } catch {}
  if (days.length >= 2) {
    const last = byDay[days[days.length - 1]], prev = byDay[days[days.length - 2]]
    const a = last.bad / last.n, b = prev.bad / prev.n
    console.log('  趋势：昨天 ' + Math.round(b * 100) + '% → 今天 ' + Math.round(a * 100) + '%，' + (a < b ? '在降' : a > b ? '在升' : '持平'))
  }
}

const [, , a, b] = process.argv
if (!a) {
  console.log(`
  sea-check —— 给装了识海的机器用的自检

    sea-check 我的回复.md          扫腔（和插件运行时同一把尺子，阈值 ${BAD}）
    sea-check A.md B.md           比人格一致率（同一套题、两批答，条数要一样）
    sea-check --rules             看在查哪几条
    sea-check --trend             看这几天的命中率趋势（读插件自己落的日志）

  只读你给的文件，不读识海库、不联网、不上报。
`)
  process.exit(0)
}
if (a === '--trend') { trend(); process.exit(0) }
if (a === '--rules') {
  console.log('  在查这几条（与插件运行时同源）：')
  for (const k of KINDS) console.log('    · ' + k)
  console.log('  加分规则：有几种腔、每种最多算三次，每次 0.12，封顶 1；≥' + BAD + ' 判有腔。')
  process.exit(0)
}
if (!existsSync(a)) { console.error('  找不到文件：' + a); process.exit(1) }
if (b) {
  if (!existsSync(b)) { console.error('  找不到文件：' + b); process.exit(1) }
  console.log('  一、扫腔')
  smell(a); smell(b)
  console.log('\n  二、人格一致率')
  drift(a, b)
} else {
  smell(a)
  console.log('\n  整段一句话版：' + flavorLine(lines(a).join('\n')))
  console.log('  想看「还是不是同一个人」：拿同一套题的两批答，sea-check A.md B.md')
}
