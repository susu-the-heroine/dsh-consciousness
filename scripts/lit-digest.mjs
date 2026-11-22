/**
 * 精读包：把每篇的「摘要 + 讨论/结论」抽成一小包
 * ===============================================
 *   node scripts/lit-digest.mjs [目录]
 *
 * 为什么要它：全文一百 KB，一次读不完；摘要又太薄。
 * 折中：摘要 + 讨论/结论（各截 1800 字），一篇两三 KB，能真读进去。
 * 输出：docs/人味知识库/精读包/<PMCID>.md，并在 _index.json 记「读了哪几节」。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || join('docs', '人味知识库', '全文')
const out = join('docs', '人味知识库', '精读包')
mkdirSync(out, { recursive: true })
if (!existsSync(dir)) { console.error('  没有目录 ' + dir); process.exit(1) }

const pick = (txt, re, n = 1800) => {
  const m = txt.match(re)
  return m ? m[0].replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, n) : ''
}

const index = []
for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
  const txt = readFileSync(join(dir, f), 'utf8')
  const id = f.replace(/\.txt$/, '')
  const abs = pick(txt, /\n## Abstract[\s\S]*?(?=\n## |\n# )/)
  const disc = pick(txt, /\n## (Discussion|Conclusions?|General Discussion)[\s\S]*?(?=\n## |$)/)
  const res = pick(txt, /\n## (Results|Findings)[\s\S]*?(?=\n## |$)/, 1200)
  const meta = txt.slice(0, 400)
  const body = [meta.trim(), '', abs.trim(), '', res.trim(), '', disc.trim()].filter(Boolean).join('\n\n')
  writeFileSync(join(out, id + '.md'), body + '\n', 'utf8')
  index.push({ id, bytes: body.length, hasAbstract: !!abs, hasResults: !!res, hasDiscussion: !!disc })
}
writeFileSync(join(out, '_index.json'), JSON.stringify(index, null, 1), 'utf8')
const full = index.filter((x) => x.hasAbstract && x.hasDiscussion).length
console.log('  精读包：' + index.length + ' 篇 · 摘要+讨论都在：' + full + ' 篇')
console.log('  平均 ' + Math.round(index.reduce((a, b) => a + b.bytes, 0) / index.length / 1024) + ' KB/篇')
