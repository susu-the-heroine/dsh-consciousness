/**
 * 重排留出集 + 影子对比
 * ====================
 *   node scripts/bench-rerank-holdout.mjs
 *
 * 做法：把反馈按查询哈希切成训练/留出（七三），
 * 留出集上分别量「不重排」和「用现在这份权重重排」的命中率。
 * 只量不改，权重要不要换由人拍板。
 *
 * 反馈来源：海目录下的 feedback.jsonl（每行 {q, expect, got, verdict}）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const { SEAS_DIR } = await import('file:///' + join(HERE, '..', 'lib', 'paths.js').replace(/\\/g, '/'))
const RM = await import('file:///' + join(HERE, '..', 'lib', 'rerank-learned.js').replace(/\\/g, '/'))

const hash = (s) => {
  let h = 2166136261
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0) % 100
}

const files = []
try {
  for (const sea of readdirSync(SEAS_DIR)) {
    const p = join(SEAS_DIR, sea, 'feedback.jsonl')
    if (existsSync(p)) files.push({ sea, p })
  }
} catch {}

const rows = []
for (const f of files) {
  let n = 0
  for (const line of readFileSync(f.p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t)
      if (o && o.q && o.expect) { rows.push({ ...o, sea: f.sea }); n++ }
    } catch {}
  }
  console.log(`  · ${f.sea}: ${n} 条反馈`)
}

if (!rows.length) {
  console.log('没有反馈数据，留出集量不了。')
  process.exit(0)
}

const holdout = rows.filter((r) => hash(r.q) < 30)
const train = rows.filter((r) => hash(r.q) >= 30)
const model = RM.loadModel()

const score = (item) => {
  const f = RM.featuresOf(item.q, { title: item.expectTitle || item.expect || '', text: item.expectText || '' }, Number(item.cos) || 0)
  return RM.probOf(f, model) ?? 0
}

// 2026-11-21：原来只数「模型说这条判对」有几条，压根没跟真值对。模型要是全说对，就是百分百，
// 跟真值对不对无关；而且头里承诺的「不重排」那一臂从来没算过。
// 现在两臂都对着真值算：
//   不重排：反馈里本来就判对的比例（检索自己找到的）
//   重排后：模型说对/说错 跟 真值对/错 一致的比例
const truth = (r) => String(r.verdict || '').toLowerCase() === 'hit'
const baseline = (list) => {
  const hit = list.filter(truth).length
  return list.length ? Number(((hit / list.length) * 100).toFixed(2)) : 0
}
const judge = (list) => {
  const agree = list.filter((r) => (score(r) > 0.5) === truth(r)).length
  return list.length ? Number(((agree / list.length) * 100).toFixed(2)) : 0
}

console.log(`反馈共 ${rows.length} 条 · 训练 ${train.length} · 留出 ${holdout.length}`)
// 2026-11-21：没有训练好的模型时，每条都算「没判对」，上面两行就变成算术假象。先说清。
if (!model) {
  console.log('没有训练好的重排模型（每条都按「没判对」算），下面这两行不是重排效果，别拿它比。')
}
console.log(`留出集 · 不重排（反馈本来判对的比例）：${baseline(holdout)}%`)
console.log(`留出集 · 重排后（跟真值一致的比例）：${judge(holdout)}%（阈值 0.5）`)
console.log(`影子对比：训练集 重排 ${judge(train)}%（不重排 ${baseline(train)}%） · 留出 重排 ${judge(holdout)}%（不重排 ${baseline(holdout)}%）`)
console.log('（只量不改。要换权重，先把留出集这条线记住，换完再跑一次对比。）')
