/**
 * 跑假库题：谁都能跑的那一层
 * ========================
 *
 *   node scripts/bench-gen.mjs && node scripts/bench-run.mjs
 *
 * 在临时目录里建一个假海，跑五十道题 + 十五条反例，出成绩。
 * 不碰主库，不写他的识海。
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-bench-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool } = await import(LIB + '/tools.js')
const { resolveRef } = await import(LIB + '/context.js')

// 2026-11-21：题目文件不在时，这里直接抛 ENOENT 的栈——一堆英文路径，看不出该干什么。
// 实测：把数据目录挪走再跑，退出码 1、只留一段栈。改成说人话。
const suitePath = join(HERE, 'data', 'bench-synth.json')
if (!existsSync(suitePath)) {
  console.log('题目文件不在：' + suitePath)
  console.log('先跑 node scripts/bench-gen.mjs 造题，再跑这个。')
  process.exit(2)
}
const suite = JSON.parse(readFileSync(suitePath, 'utf8'))
writeSea('main', { version: 3, points: suite.points, edges: [] })

const rank = (log) => {
  const ids = []
  for (const line of String(log || '').split('\n')) {
    const m = line.match(/^· #(\d+)/)
    if (m) ids.push(Number(m[1]))
  }
  return ids
}

const stat = { title: {}, paraphrase: {}, typo: {}, anaphora: {}, neg: {} }
const lat = []
const fails = []
for (const c of suite.cases) {
  const t0 = Date.now()
  let ids = []
  try {
    const qq = c.q
    const prev = c.kind === 'anaphora' ? c.prev : undefined
    const r = await searchTool.execute({ query: qq, prev, limit: 5, review: false })
    ids = rank(r.log)
    if (!ids.length && c.expect) fails.push({ q: c.q, kind: c.kind, got: '没回话' })
  } catch (e) {
    fails.push({ q: c.q, kind: c.kind, got: '抛错 ' + String((e && e.message) || e) })
  }
  lat.push(Date.now() - t0)
  const bucket = stat[c.kind]
  bucket.n = (bucket.n || 0) + 1
  if (c.kind === 'neg') {
    if (ids.length) bucket.hit = (bucket.hit || 0) + 1
  } else {
    const pos = ids.indexOf(Number(c.expect))
    if (pos === 0) bucket.top1 = (bucket.top1 || 0) + 1
    if (pos >= 0 && pos < 3) bucket.top3 = (bucket.top3 || 0) + 1
    if (pos < 0) fails.push({ q: c.q, kind: c.kind, got: '没进前五' })
  }
}

lat.sort((a, b) => a - b)
const pickP = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]
const pct = (a, n) => (n ? ((a / n) * 100).toFixed(1) : '—')

const lines = []
lines.push('# 假库题成绩（谁都能跑的那一层）')
lines.push('')
lines.push(`生成于 ${new Date().toISOString()} · 记忆 ${suite.points.length} 条 · 题 ${suite.cases.length} 道`)
lines.push('')
lines.push(`- 标题原话：头名 ${pct(stat.title.top1, stat.title.n)}% · 前三 ${pct(stat.title.top3, stat.title.n)}%（${stat.title.n} 道）`)
lines.push(`- 换说法：头名 ${pct(stat.paraphrase.top1, stat.paraphrase.n)}% · 前三 ${pct(stat.paraphrase.top3, stat.paraphrase.n)}%（${stat.paraphrase.n} 道）`)
lines.push(`- 错一个字：头名 ${pct(stat.typo.top1, stat.typo.n)}% · 前三 ${pct(stat.typo.top3, stat.typo.n)}%（${stat.typo.n} 道）`)
lines.push(`- 指代（那个东西/它）：头名 ${pct(stat.anaphora.top1, stat.anaphora.n)}% · 前三 ${pct(stat.anaphora.top3, stat.anaphora.n)}%（${stat.anaphora.n} 道）`)
lines.push(`- 反例（库里没有的事）：有回话 ${stat.neg.hit || 0}/${stat.neg.n}`)
lines.push(`- 延迟：中位 ${pickP(0.5)}ms · p95 ${pickP(0.95)}ms`)
lines.push('')
lines.push('## 没答上的')
for (const f of fails.slice(0, 12)) lines.push(`- [${f.kind}] ${f.q} → ${f.got}`)
if (!fails.length) lines.push('- 没有')
lines.push('')
lines.push('> 这层用的是假记忆，谁装谁跑都同一套题；真库那层用他自己的三百七十道，见 big-eval。')

writeFileSync(join(HERE, 'data', 'bench-synth-report.md'), lines.join('\n'), 'utf8')
writeFileSync(join(HERE, 'data', 'bench-synth-report.json'), JSON.stringify({
  at: new Date().toISOString(), points: suite.points.length, cases: suite.cases.length,
  stat, latency: { p50: pickP(0.5), p95: pickP(0.95) }, fails: fails.slice(0, 30),
}, null, 1))

console.log(lines.slice(3, 9).join('\n'))
rmSync(home, { recursive: true, force: true })
