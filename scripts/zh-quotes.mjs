/**
 * 中文多人语料 · 从开放获取的质性研究里抽受访者原话
 * ==================================================
 *   node scripts/zh-quotes.mjs
 *
 * 为什么要这么绕：公开对话语料（GitHub / HF / Zenodo）本机全取不到，
 * 但 Europe PMC 通。质性研究（访谈、焦点小组）会把受访者原话成段引在正文里，
 * 而且是中文、多个人、真实说话。这就是能拿到的「多人分布」。
 *
 * 只取 OA 全文；每条都记来源 PMID，可回查。写进 docs/中文多人语料-v0.md。
 */
import { writeFileSync } from 'node:fs'

const SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const FULL = 'https://www.ebi.ac.uk/europepmc/webservices/rest'

const q = encodeURIComponent('(LANGUAGE:"chi") AND (访谈 OR 质性 OR 焦点小组 OR 深度访谈) AND OPEN_ACCESS:y')
const listUrl = SEARCH + '?query=' + q + '&format=json&pageSize=30&resultType=core'
const j = await fetch(listUrl, { signal: AbortSignal.timeout(20000) }).then((r) => r.json())
const hits = ((j && j.resultList && j.resultList.result) || []).filter((x) => x.pmcid || x.pmid)
console.log('  命中 ' + hits.length + ' 篇（中文 · 质性 · 开放）')

const quotes = []
const used = []
for (const h of hits) {
  const pmcid = h.pmcid
  if (!pmcid) continue
  try {
    const xml = await fetch(FULL + '/' + pmcid + '/fullTextXML', { signal: AbortSignal.timeout(20000) }).then((r) => r.text())
    // 中文引号（“ ”）与直角引号（「 」）里的句子
    const found = [...xml.matchAll(/[“「]([^”」]{5,80})[”」]/g)].map((m) => m[1].trim())
    const zh = found.filter((s) => /^[\u4e00-\u9fa5，。！？、…—\s]+$/.test(s))
    if (zh.length) {
      used.push({ pmcid, title: String(h.title || '').slice(0, 40), n: zh.length })
      quotes.push(...zh.map((s) => ({ s, pmcid })))
    }
  } catch {}
}

const uniq = [...new Map(quotes.map((q2) => [q2.s, q2])).values()]
const out = [
  '# 中文多人语料 v0（从开放获取质性研究里抽的受访者原话）',
  '',
  '用途：给「多人分布」当底，替换「只有他一个人」的基线。',
  '限制：这些是论文里被整理过的引语，标点和断句被编辑过，不是聊天原文；只能当粗略分布。',
  '',
  '## 来源',
  '',
  ...used.map((u) => '- PMC' + u.pmcid + ' · ' + u.title + ' · ' + u.n + ' 句'),
  '',
  '## 句子（' + uniq.length + ' 条去重）',
  '',
  ...uniq.slice(0, 200).map((q3, i) => (i + 1) + '. ' + q3.s + '（PMC' + q3.pmcid + '）'),
]
writeFileSync('docs/中文多人语料-v0.md', out.join('\n') + '\n', 'utf8')
console.log('  抽出句子 ' + quotes.length + ' · 去重后 ' + uniq.length + ' · 来自 ' + used.length + ' 篇')
