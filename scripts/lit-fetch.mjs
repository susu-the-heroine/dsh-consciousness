/**
 * 文献抓取器（开放获取优先）
 * ==========================
 *   node scripts/lit-fetch.mjs "query" [条数]
 *
 * 走 Europe PMC 的公开接口：
 *   1) 检索：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=...&format=json&pageSize=N&resultType=core
 *   2) 全文：https://www.ebi.ac.uk/europepmc/webservices/rest/{PMCID}/fullTextXML
 * 只收 openAccess=Y 且带 PMCID 的；拿不到全文的记进 misses.json，不假装读过。
 *
 * 落盘：
 *   docs/人味知识库/全文/<PMCID>.xml   原文
 *   docs/人味知识库/全文/<PMCID>.json  标题、作者、年份、期刊、DOI、PMID、PMCID、摘要
 *   docs/人味知识库/全文/_index.json   本轮清单
 *   docs/人味知识库/全文/_misses.json  没抓到全文的
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join('docs', '人味知识库', '全文')
const q = process.argv[2] || 'fuzzy trace theory memory'
const n = Math.max(1, Math.min(50, Number(process.argv[3] || 10)))

const api = (u) => fetch(u, {
  headers: { 'user-agent': 'dsh-consciousness-lit/1.0 (research; contact: local)' },
  signal: AbortSignal.timeout(12000),
})

mkdirSync(OUT, { recursive: true })
const search = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=' + n
  + '&query=' + encodeURIComponent(q + ' AND OPEN_ACCESS:Y')
let j = null
for (let attempt = 0; attempt < 3 && !j; attempt++) {
  try {
    const r = await api(search)
    if (!r.ok) { console.error('  检索失败 HTTP ' + r.status); process.exit(1) }
    j = await r.json()
  } catch (e) {
    console.error('  检索超时/出错（第 ' + (attempt + 1) + ' 次），重试')
    await new Promise((res) => setTimeout(res, 1500))
  }
}
if (!j) { console.error('  检索三次都没成，退出'); process.exit(2) }
const list = (j.resultList && j.resultList.result) || []
console.log('  检索命中：' + list.length + '（query=' + q + '）')

const index = []
const misses = []
const t0 = Date.now()
const queue = [...list]
const worker = async () => {
  while (queue.length) {
    const it = queue.shift()
    try { await one(it) } catch (e) {
      misses.push({ pmcid: it.pmcid || '', title: it.title || '', why: 'throw:' + String((e && e.name) || e) })
    }
  }
}
async function one(it) {
  const pmcid = it.pmcid || ''
  const meta = {
    title: it.title || '',
    authors: it.authorString || '',
    year: it.pubYear || '',
    journal: (it.journalInfo && it.journalInfo.journal && it.journalInfo.journal.title) || '',
    doi: it.doi || '',
    pmid: it.pmid || '',
    pmcid,
    abstract: (it.abstractText || '').slice(0, 4000),
  }
  if (!pmcid) { misses.push({ ...meta, why: 'no-pmcid' }); return }
  const file = join(OUT, pmcid + '.xml')
  if (!existsSync(file)) {
    let fr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      fr = await api('https://www.ebi.ac.uk/europepmc/webservices/rest/' + pmcid + '/fullTextXML')
      if (fr.status === 429) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue }
      break
    }
    if (!fr || !fr.ok) { misses.push({ ...meta, why: 'fulltext HTTP ' + (fr ? fr.status : 'null') }); return }
    const txt = await fr.text()
    writeFileSync(file, txt, 'utf8')
    writeFileSync(join(OUT, pmcid + '.json'), JSON.stringify(meta, null, 1), 'utf8')
  }
  index.push({ pmcid, title: meta.title, year: meta.year, journal: meta.journal })
  console.log('  ✓ ' + pmcid + '  ' + String(meta.year) + '  ' + meta.title.slice(0, 60))
}
await Promise.all(Array.from({ length: 12 }, worker))
console.log('  并发 6 抓完，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒')
writeFileSync(join(OUT, '_index.json'), JSON.stringify(index, null, 1), 'utf8')
writeFileSync(join(OUT, '_misses.json'), JSON.stringify(misses, null, 1), 'utf8')
console.log('  全文落盘：' + index.length + ' · 缺全文：' + misses.length)
