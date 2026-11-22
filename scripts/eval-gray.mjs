process.env.C2_NO_REFUSAL_LOG = '1' // 评测不往真实账本写
/**
 * 灰区题：问「有这件事、没这个细节」。
 * 量两件：能不能翻到那件事（前五）、会不会干脆说没记（空）。
 */
const { readFileSync } = await import('node:fs')
const { join, dirname } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const HERE = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(HERE, 'data', 'gray-eval.json'), 'utf8')).cases
const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
let hit = 0, empty = 0, nearMark = 0
const misses = []
for (const c of cases) {
  const r = await T.searchTool.execute({ query: c.q, limit: 5, review: false })
  const log = String(r.log || '')
  const ids = log.split('\n').map((l) => (l.match(/^· #(\d+)/) || [])[1]).filter(Boolean).map(Number)
  // 2026-11-21：有一种答法不给编号清单，直接引原文（「记着这么回事——《…》」）。
  // 那是答上了，不是空；以前的量法把它算成「空」，把六条里两条好答案冤枉了。
  const quoted = (log.match(/记着这么回事——《([^》]+)》/) || [])[1] || ''
  const wantTitle = (S.readSea('main').points.find((p) => Number(p.id) === Number(c.want)) || {}).title || ''
  // 有的答法直接引原文、有的写成「你这事我记着」——都算答上，只要正文里点了那条标题。
  const titleMentioned = wantTitle && log.includes(wantTitle)
  const quotedHit = titleMentioned || (quoted && wantTitle && (quoted === wantTitle || quoted.includes(wantTitle) || wantTitle.includes(quoted)))
  const at = ids.indexOf(Number(c.want))
  if ((at >= 0 && at < 5) || quotedHit) hit++
  // 2026-11-21：什么叫「空」——整条说「没记过」才算空。
  // 「这事我记着，细节我糊了」和「是不是这条」正是我们要的答法，不该记成空。
  const saidMissing = /没记过/.test(log)
  if (saidMissing) { empty++; misses.push('空：' + c.q) }
  else if (!quotedHit && at < 0) {
    // 顶了邻条但标了「只是挨着」——算诚实的错，不算错答。
    if (/只是挨着/.test(log)) nearMark++
    else misses.push('错：' + c.q + ' → ' + (ids.slice(0, 2).join(',') || '引了别的'))
  }
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '-')
console.log('灰区 ' + cases.length + ' 题：前五翻到 ' + hit + '（' + pct(hit, cases.length) + '%）· 空 ' + empty + ' · 标了邻条 ' + nearMark)
for (const m of misses) console.log('  ' + m)