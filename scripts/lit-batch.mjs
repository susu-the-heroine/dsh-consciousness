/**
 * 批量抓：按主题清单跑一遍 lit-fetch
 * ==================================
 *   node scripts/lit-batch.mjs [每主题条数，默认 6]
 *
 * 主题清单在下面 TOPICS，改这里就换方向。
 * 抓到的全文落在 docs/人味知识库/全文/，重复主题不会重复下载（同名跳过）。
 */
import { spawnSync } from 'node:child_process'

const TOPICS = [
  'fuzzy trace theory gist verbatim memory',
  'tip of the tongue retrieval failure',
  'source monitoring memory misattribution',
  'conversational repair self correction dialogue',
  'human-likeness evaluation conversational agent',
  'anthropomorphism social actors computers',
  'autobiographical memory specificity overgeneral',
  'forgetting curve retention interval recall',
]

const n = String(Number(process.argv[2] || 6))
let total = 0
for (const t of TOPICS) {
  const r = spawnSync(process.execPath, ['scripts/lit-fetch.mjs', t, n], { encoding: 'utf8' })
  const out = String(r.stdout || '')
  const m = out.match(/全文落盘：(\d+)/)
  const got = m ? Number(m[1]) : 0
  total += got
  console.log('  [' + got + '] ' + t)
  if (r.status !== 0) console.log('    失败：' + String(r.stderr || '').slice(0, 120))
}
console.log('  合计新落盘：' + total + ' 篇')
