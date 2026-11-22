/**
 * 从 74 万字真实对话里抽「他说的话」（待标 op/narr/unknown）
 * ==========================================================
 * 源：C:/Users/Administrator/Desktop/大肥鱼档案/04_原始对话_74万字.md
 * 只取 苏苏侠 的段落，砍掉长指令、代码块、文件，剩日常短句。
 * 跑法：node scripts/extract-user-pool.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = 'C:/Users/Administrator/Desktop/大肥鱼档案/04_原始对话_74万字.md'
const md = readFileSync(SRC, 'utf8')

const parts = md.split(/^## \[\d+\] /m).slice(1)
const lines = []
for (const p of parts) {
  const head = (p.split(/\r?\n/)[0] || '').trim()
  if (!head.startsWith('苏苏侠')) continue
  let body = p.split(/\r?\n/).slice(1).join('\n')
  body = body.replace(/\*\*〔[^〕]*〕\*\*/g, '').trim()
  if (body.startsWith('```') || body.startsWith('📁')) continue
  for (const raw of body.split(/\r?\n/)) {
    const t = raw
      .trim()
      .replace(/^[-*>#]+\s*/, '')
      .replace(/^📁.*$/, '')
      .trim()
    if (t.length < 4 || t.length > 26) continue
    if (/^(```|【|第[一二三四五六七八九十]+部分|•)/.test(t)) continue
    lines.push(t)
  }
}

const uniq = [...new Set(lines)]
const out = join(HERE, 'data', 'intent-user-pool.json')
writeFileSync(out, JSON.stringify({
  note: '赛博军师真实对话（74 万字，758 条）里他说的话抽出来，待标 op/narr/unknown',
  total: uniq.length,
  cases: uniq.slice(0, 400).map((q) => ({ q })),
}, null, 1))

const sample = uniq
  .slice(0, 400)
  .filter((_, i) => i % 7 === 0)
  .slice(0, 40)
  .map((q, i) => `${i + 1}. ${q}`)
  .join('\n')
writeFileSync(join(HERE, 'data', 'intent-user-sample.txt'), sample, 'utf8')
console.log(`他的短句 ${uniq.length} 条；已存前 400 -> ${out}`)
