/**
 * 回复自检（报告腔扫描）
 * ======================
 *   node scripts/reply-lint.mjs <文件>      # 一行一条
 *   node scripts/reply-lint.mjs             # 默认扫对话级题里的 A/B 两侧
 *
 * 检查项来自评者原话（对话级第 2 轮）：
 *   「我的看法是」「简单说」「做成常驻」这类是报告标记；
 *   带具体时间、带自我承认的更像人。
 *
 * 每条回复打分：命中一个报告标记扣一分，有具体数字或时间加一分。
 * 输出：违规率、最常见的三个标记、以及最该改的三条。
 */
import { readFileSync, existsSync } from 'node:fs'

const MARKERS = [
  ['我的看法是', /我的看法是/],
  ['简单说', /简单说|说白了就是/],
  ['做成常驻', /做成常驻|落成机制|形成闭环/],
  ['首先/其次', /首先|其次|再者/],
  ['这说明', /这说明|这意味着|由此可见/],
  ['总结腔', /总的来说|总之|一句话概括/],
  ['评估腔', /值得做|优先级|闭环|抓手/],
]
const CONCRETE = /\d|周[一二三四五六日]|昨天|今天|凌晨|点|小时|分钟|第[一二三四五六七八九十]/

export function lintOne(text) {
  const t = String(text || '')
  const hits = MARKERS.filter(([, re]) => re.test(t)).map(([name]) => name)
  const concrete = CONCRETE.test(t)
  return { hits, concrete, score: (concrete ? 1 : 0) - hits.length, len: [...t].length }
}

function runDefault() {
  const p = 'docs/对话级盲测-第2轮.md'
  if (!existsSync(p)) { console.log('  没找到题面文件'); return }
  const lines = readFileSync(p, 'utf8').split('\n')
  const sides = { A: [], B: [] }
  for (const l of lines) {
    if (l.startsWith('A. ')) sides.A.push(l.slice(3))
    if (l.startsWith('B. ')) sides.B.push(l.slice(3))
  }
  for (const [k, arr] of Object.entries(sides)) {
    const res = arr.map(lintOne)
    const bad = res.filter((r) => r.hits.length > 0).length
    const avgLen = (arr.reduce((s, t) => s + [...t].length, 0) / arr.length).toFixed(0)
    console.log('  ' + k + ' 侧：' + arr.length + ' 条 · 带报告标记 ' + bad + ' 条（' + ((bad / arr.length) * 100).toFixed(0) + '%）· 平均 ' + avgLen + ' 字')
    const counts = {}
    res.forEach((r) => r.hits.forEach((h) => { counts[h] = (counts[h] || 0) + 1 }))
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (top.length) console.log('    最常见：' + top.map(([n, c]) => n + '×' + c).join('、'))
  }
}

if (process.argv[2]) {
  const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
  const res = lines.map(lintOne)
  const bad = res.filter((r) => r.hits.length > 0)
  console.log('  样本 ' + lines.length + ' · 带标记 ' + bad.length + '（' + ((bad.length / lines.length) * 100).toFixed(0) + '%）')
  let left = 3
  res.forEach((r, i) => { if (r.hits.length && left-- > 0) console.log('    第 ' + (i + 1) + ' 条：' + r.hits.join('、')) })
} else {
  runDefault()
}
