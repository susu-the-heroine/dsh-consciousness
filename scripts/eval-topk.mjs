/**
 * 检索分层评测：头名 / 前三 / 前五 / 前十，按题型分组，失败分型
 * ==========================================================
 *   node scripts/eval-topk.mjs            # 临时库里跑，不碰真库
 *   node scripts/eval-topk.mjs --keep     # 跑完留着临时库，方便复查
 *
 * 输出：
 *   控制台摘要
 *   docs/评测-topk.md        给人看的表
 *   scripts/data/eval-topk.json  机器读的明细
 *
 * 失败分型（只看有标准答案的题）：
 *   not-retrieved  前十都没进去 —— 召回问题
 *   ranked-low     前十进去了但没进头名 —— 排序问题
 * 否定题（want 为空）单独算：
 *   refused-ok     一条没返回，算对
 *   answered       返回了东西，算错（该拒没拒）
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const REAL_HOME = process.env.USERPROFILE || homedir()
const SRC_SEA = join(REAL_HOME, '.dsh', 'consciousness-seas', 'main')
const KEEP = process.argv.includes('--keep')
// --deep：把候选池拉到 40 条，量一下「答案到底在不在池子里」——用来判断该修召回还是修排序。
const DEEP = process.argv.includes('--deep')
// --review：让检索真的回写（强化、悬着标记），用来量"写回到底影不影响排序"。默认不写。
const REVIEW = process.argv.includes('--review')
const DEPTH = DEEP ? 40 : 10

if (!existsSync(SRC_SEA)) {
  console.error('找不到 main 海：' + SRC_SEA)
  process.exit(2)
}

// 先把 HOME 指到临时库，再动态导入——路径模块在导入时就读环境变量
const tmp = mkdtempSync(join(tmpdir(), 'topk-'))
const seas = join(tmp, '.dsh', 'consciousness-seas')
mkdirSync(seas, { recursive: true })
cpSync(SRC_SEA, join(seas, 'main'), { recursive: true })
process.env.USERPROFILE = tmp
process.env.HOME = tmp

const { searchTool } = await import('file:///' + join(ROOT, 'lib', 'tools.js').replace(/\\/g, '/'))

const cases = (JSON.parse(readFileSync(join(HERE, 'data', 'big-eval.json'), 'utf8')).cases || [])
  .filter((c) => c && c.q)

const ids = (log) =>
  String(log || '')
    .split('\n')
    .map((l) => l.match(/^· #(\d+)/))
    .filter(Boolean)
    .map((m) => Number(m[1]))

const rows = []
for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: DEPTH, review: REVIEW })
  const got = ids(r.log)
  const want = c.want == null ? null : Number(c.want)
  const kind = c.kind || 'unknown'
  const rank = want == null ? null : (got.indexOf(want) + 1 || null)
  let verdict
  if (want == null) {
    verdict = got.length ? 'answered' : 'refused-ok'
  } else if (rank == null) {
    verdict = 'not-retrieved'
  } else if (rank === 1) {
    verdict = 'top1'
  } else {
    verdict = 'ranked-' + rank
  }
  rows.push({ q: c.q, kind, split: c.split || '', want, rank, got: got.slice(0, 10), verdict })
}

const kinds = [...new Set(rows.map((r) => r.kind))]
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '-')

// 名次一律用数字判，不再靠 verdict 字符串——深池模式里会出现 ranked-25 这种，字符串会把前十条算错。
const sum = (list) => ({
  n: list.length,
  top1: list.filter((r) => r.rank === 1).length,
  top3: list.filter((r) => r.rank != null && r.rank <= 3).length,
  top5: list.filter((r) => r.rank != null && r.rank <= 5).length,
  top10: list.filter((r) => r.rank != null && r.rank <= 10).length,
  any: list.filter((r) => r.rank != null).length,
  miss: list.filter((r) => r.rank == null).length,
})

// 2026-11-21：答案本身已经失效（标死或归档）的题，不能跟「没找到」混着算。
// 实测：标题题漏的五条（#127/#129/#138/#143/#144）全是已归档——
// 它们该被当成「该拒答」，现在却被算成漏，还掩盖了「系统拿了别的条目当答案」这层错。
try {
  const _d = JSON.parse(readFileSync(join(seas, 'main', 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
  const _gone = new Set((_d.points || []).filter((p) => p.dead || p.archived).map((p) => Number(p.id)))
  for (const r of rows) r.gone = r.want != null && _gone.has(Number(r.want))
} catch { for (const r of rows) r.gone = false }
const goneRows = rows.filter((r) => r.gone)
if (goneRows.length) console.log(`答案已失效（标死或归档）的题：${goneRows.length} 道 —— 单独拎出来，不进命中率`)

const answerable = rows.filter((r) => r.want != null && !r.gone)
const negatives = rows.filter((r) => r.want == null)
const all = sum(answerable)
const negOk = negatives.filter((r) => r.verdict === 'refused-ok').length

// 2026-11-19（置信度三档的第一步）：把这次跑出来的检索日志读回来，
// 用「头名相对分」分桶，看每个桶里到底有多准——分不开就说明这个分不能用。
let buckets = []
let covered = 0   // 分桶实际覆盖多少题（写在这层，别关在 try 里）
try {
  const logPath = join(tmp, '.dsh', 'consciousness-search-log.jsonl')
  if (existsSync(logPath)) {
    const byQ = new Map()
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let j
      try { j = JSON.parse(line) } catch { continue }
      if (j.k !== 's' || !Array.isArray(j.top) || !j.top.length) continue
      // 2026-11-21：存和取要用同一把钥匙——原来存整句、取只取前一百二十字，
      // 问句一长就永远对不上，整段分桶悄悄变空。现在统一取前一百二十字。
      byQ.set(String(j.q || '').slice(0, 120), j.top[0])
    }
    const withRel = answerable
      .map((r) => {
        const t = byQ.get(String(r.q).slice(0, 120))
        const rel = t && Number.isFinite(Number(t.r)) ? Number(t.r) : null
        return { r, rel }
      })
      .filter((x) => x.rel != null)
    // 2026-11-21：这张表只统计「日志里有头名相对分」的题。检索一条没回的题没有这个分，
    // 于是被悄悄排除——报告上看着是校准，其实只覆盖了能答出来的那部分。把分母说清楚。
    covered = withRel.length
    const edges = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 2]]
    buckets = edges.map(([lo, hi]) => {
      const list = withRel.filter((x) => x.rel >= lo && x.rel < hi)
      const ok = list.filter((x) => x.r.verdict === 'top1').length
      return { lo, hi, n: list.length, ok }
    })
  }
} catch {}

const lines = []
lines.push('# 检索分层评测')
lines.push('')
lines.push('> 临时库里跑，题量 ' + rows.length + '；能答题 ' + answerable.length + '，否定题 ' + negatives.length + '。')
lines.push('')
lines.push('| 分组 | 题数 | 头名 | 前三 | 前五 | 前十 | 前十没进 |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
const one = (name, list) => {
  const s = sum(list)
  lines.push(
    `| ${name} | ${s.n} | ${pct(s.top1, s.n)}% | ${pct(s.top3, s.n)}% | ${pct(s.top5, s.n)}% | ${pct(s.top10, s.n)}% | ${s.miss} |`
  )
}
one('全部', answerable)
for (const k of kinds) {
  const list = answerable.filter((r) => r.kind === k)
  if (list.length) one(k, list)
}
lines.push('')
lines.push(`否定题：${negOk}/${negatives.length} 正确拒答（${pct(negOk, negatives.length)}%）`)
lines.push('')
lines.push('## 失败清单（前十没进的）')
lines.push('')
const misses = rows.filter((r) => r.verdict === 'not-retrieved')
for (const r of misses.slice(0, 60)) {
  lines.push(`- [${r.kind}] ${r.q} → 想要 #${r.want}，拿到 ${r.got.length ? r.got.join(',') : '空'}`)
}
if (!misses.length) lines.push('- 无')
lines.push('')
lines.push('## 排错榜（进去了但不是头名）')
lines.push('')
const low = rows.filter((r) => /^ranked-/.test(r.verdict)).sort((a, b) => Number(a.verdict.split('-')[1]) - Number(b.verdict.split('-')[1]))
for (const r of low.slice(0, 40)) {
  lines.push(`- [${r.kind}] ${r.verdict.replace('ranked-', '第')}：${r.q}`)
}
if (!low.length) lines.push('- 无')

mkdirSync(join(ROOT, 'docs'), { recursive: true })
writeFileSync(join(ROOT, 'docs', '评测-topk.md'), lines.join('\n') + '\n', 'utf8')
writeFileSync(join(HERE, 'data', 'eval-topk.json'), JSON.stringify(rows, null, 1), 'utf8')

console.log(`总题 ${rows.length}｜能答 ${answerable.length}｜否定 ${negatives.length}`)
console.log(`头名 ${pct(all.top1, all.n)}%｜前三 ${pct(all.top3, all.n)}%｜前五 ${pct(all.top5, all.n)}%｜前十 ${pct(all.top10, all.n)}%`)
if (DEEP) console.log(`池子里（前 ${DEPTH}）有没有答案：${all.any}/${all.n} = ${pct(all.any, all.n)}%（这个数跟头名的差，就是排序能捡回来的上限）`)
console.log(`否定题 ${negOk}/${negatives.length} = ${pct(negOk, negatives.length)}%`)
for (const k of kinds) {
  const list = answerable.filter((r) => r.kind === k)
  if (list.length) {
    const s = sum(list)
    console.log(`  ${k}: n=${s.n} 头名 ${pct(s.top1, s.n)}% 前十 ${pct(s.top10, s.n)}% 漏 ${s.miss}`)
  }
}
console.log('明细写进 docs/评测-topk.md')

if (buckets && buckets.length) {
  const seg = buckets.map((b) => `${b.lo}-${b.hi}: ${b.ok}/${b.n} = ${pct(b.ok, b.n)}%`).join('｜')
  console.log('按头名相对分分桶（准确率）：' + seg)
  console.log('分桶覆盖 ' + covered + ' / ' + answerable.length + ' 题；没回话、没相对分的不进表')
  const md = ['', '## 按头名相对分分桶（校准用）', '',
    '> 覆盖 ' + covered + ' / ' + answerable.length + ' 题；剩下 ' + (answerable.length - covered)
      + ' 题检索没回话、没有相对分，不进这张表。',
    '', '| 相对分区间 | 题数 | 头名对 | 准确率 |', '| --- | --- | --- | --- |']
  for (const b of buckets) md.push(`| ${b.lo}–${b.hi} | ${b.n} | ${b.ok} | ${pct(b.ok, b.n)}% |`)
  writeFileSync(join(ROOT, 'docs', '评测-topk.md'), md.join('\n') + '\n', { encoding: 'utf8', flag: 'a' })
}

// Windows 上偶尔删不掉：sqlite 的连接或防抖计时器还挂着。
// 删不掉不算失败——留个路径，别把整轮评测拖红（2026-11-19）。
if (!KEEP) {
  try { rmSync(tmp, { recursive: true, force: true }) }
  catch { console.log('临时库这次没删掉（进程还占着）：' + tmp) }
} else console.log('临时库留着：' + tmp)
