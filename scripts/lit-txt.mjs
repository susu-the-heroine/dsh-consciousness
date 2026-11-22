/**
 * 把 PMC 的 JATS XML 转成能读的纯文本
 * ===================================
 *   node scripts/lit-txt.mjs [目录]
 *
 * 输入：docs/人味知识库/全文/*.xml（lit-fetch.mjs 抓的）
 * 输出：同目录同名 .txt —— 标题、期刊年份、摘要、各节标题与正文，按行接起来。
 * 目的：让我能按节读（每轮读一节），不用硬啃 XML 标签。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || join('docs', '人味知识库', '全文')
if (!existsSync(dir)) { console.error('  目录不存在：' + dir); process.exit(1) }
const files = readdirSync(dir).filter((f) => f.endsWith('.xml'))
console.log('  XML：' + files.length + ' 篇')

const unescape = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")

function convert(xml) {
  let s = xml
  // 去掉引用列表、表格、公式等非正文块（太长且读不出重点）
  s = s.replace(/<ref-list[\s\S]*?<\/ref-list>/g, '\n')
  s = s.replace(/<table-wrap[\s\S]*?<\/table-wrap>/g, '\n')
  s = s.replace(/<disp-formula[\s\S]*?<\/disp-formula>/g, ' ')
  // 节标题单独成行
  s = s.replace(/<title>/g, '\n## ').replace(/<\/title>/g, '\n')
  s = s.replace(/<p(\s[^>]*)?>/g, '\n').replace(/<\/p>/g, '\n')
  // 其余标签全去
  s = s.replace(/<[^>]+>/g, ' ')
  s = unescape(s)
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/\n\s*\n+/g, '\n\n')
  return s.trim()
}

let ok = 0
for (const f of files) {
  const xml = readFileSync(join(dir, f), 'utf8')
  const metaPath = join(dir, f.replace(/\.xml$/, '.json'))
  let meta = {}
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch {}
  const head = '# ' + (meta.title || f) + '\n\n- 作者：' + (meta.authors || '') + '\n- 出处：' + (meta.journal || '') + ' ' + (meta.year || '') + '\n- DOI：' + (meta.doi || '') + '\n- PMCID：' + (meta.pmcid || f.replace(/\.xml$/, '')) + '\n\n'
  const body = convert(xml)
  writeFileSync(join(dir, f.replace(/\.xml$/, '.txt')), head + body + '\n', 'utf8')
  ok++
}
console.log('  转好：' + ok + ' 篇 · 目录 ' + dir)
