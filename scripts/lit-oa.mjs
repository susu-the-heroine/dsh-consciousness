/**
 * 找合法开放副本（不打付费墙）
 * ============================
 *   node scripts/lit-oa.mjs "query" [条数]
 *
 * 走 OpenAlex 公开接口：https://api.openalex.org/works?search=...&filter=has_oa_accepted_or_published_version:true
 * 只认「作者自存版 / 机构库 / 期刊 OA」这三类 oa_url，逐条试着下载 PDF；
 * 拿不到 PDF 就退回 landing page 的元数据（标题/摘要/链接），不再装读。
 *
 * 落盘：
 *   docs/人味知识库/开放副本/<slug>.pdf   能下到的 PDF
 *   docs/人味知识库/开放副本/_index.json   清单：题目、年份、DOI、OA 地址、本地文件、状态
 *
 * 合规：只走公开接口与公开链接；不伪造身份、不绕验证、不碰需要登录的页面。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join('docs', '人味知识库', '开放副本')
const q = process.argv[2] || 'fuzzy trace theory memory'
const n = Math.max(1, Math.min(50, Number(process.argv[3] || 10)))
mkdirSync(OUT, { recursive: true })

const UA = { 'user-agent': 'dsh-consciousness-lit/1.0 (academic reading; local use)' }
const MAILTO = process.env.LIT_MAILTO || 'local-research@example.com'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = async (u) => {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) })
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue }
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  }
  throw new Error('HTTP 429 after retries')
}
const slug = (s) => String(s).replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 80)

const url = 'https://api.openalex.org/works?per-page=' + n + '&mailto=' + encodeURIComponent(MAILTO) + '&search=' + encodeURIComponent(q)
const data = await js(url)
const list = (data.results || [])
console.log('  OpenAlex 命中：' + list.length + '（query=' + q + '）')

const index = []
const queue = [...list]
async function one(w) {
  const oa = w.best_oa_location || (w.open_access && w.open_access.oa_url ? { pdf_url: w.open_access.oa_url, landing_page_url: w.open_access.oa_url } : null)
  const rec = {
    title: w.title || '',
    year: w.publication_year || '',
    doi: w.doi || '',
    venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    oa_url: (oa && (oa.pdf_url || oa.landing_page_url)) || '',
    file: '',
    status: 'no-oa',
  }
  if (!rec.oa_url) { index.push(rec); return }
  const name = slug(w.id ? String(w.id).split('/').pop() : rec.title) + '.pdf'
  const path = join(OUT, name)
  try {
    const r = await fetch(rec.oa_url, { headers: UA, signal: AbortSignal.timeout(15000) })
    const ct = String(r.headers.get('content-type') || '')
    if (r.ok && /pdf/i.test(ct)) {
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 20000) {
        writeFileSync(path, buf)
        rec.file = name
        rec.status = 'pdf'
        console.log('  ✓ ' + rec.year + ' ' + rec.title.slice(0, 56) + '  (' + Math.round(buf.length / 1024) + ' KB)')
      } else { rec.status = 'too-small' }
    } else {
      rec.status = 'not-pdf:' + ct.split(';')[0]
    }
  } catch (e) { rec.status = 'fetch-fail' }
  index.push(rec)
}
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const w = queue.shift()
    try { await one(w) } catch { index.push({ title: String(w.title || ''), status: 'worker-throw' }) }
  }
}))
writeFileSync(join(OUT, '_index.json'), JSON.stringify(index, null, 1), 'utf8')
const ok = index.filter((x) => x.status === 'pdf').length
console.log('  拿到 PDF：' + ok + '/' + index.length + ' · 清单写 docs/人味知识库/开放副本/_index.json')
