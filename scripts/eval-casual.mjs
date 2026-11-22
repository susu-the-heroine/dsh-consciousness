process.env.C2_NO_REFUSAL_LOG = '1' // 评测不往真实账本写
/**
 * 随口问的口语题：量「别名到底帮上没帮上」。
 * ======================================
 * 昨夜那批题是拿标题去检索，别名再补也量不出来；
 * 这一组是照他会怎么张嘴问来写的，问法不抄标题。
 *
 *   node scripts/eval-casual.mjs
 */
const { readFileSync } = await import('node:fs')
const { join, dirname } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const HERE = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(HERE, 'data', 'casual-eval.json'), 'utf8')).cases
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

let t1 = 0, t5 = 0, miss = 0
for (const c of cases) {
  const r = await T.searchTool.execute({ query: c.q, limit: 5, review: false })
  const ids = String(r.log || '').split('\n').map((l) => (l.match(/^· #(\d+)/) || [])[1]).filter(Boolean).map(Number)
  const at = ids.indexOf(Number(c.want))
  if (at === 0) t1++
  if (at >= 0 && at < 5) t5++
  if (at < 0) miss++
  console.log('  ' + (at === 0 ? '头名✓' : at > 0 ? ('第' + (at + 1) + '位') : '没进') + '  ' + c.q + ' → ' + ids.slice(0, 3).join(','))
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '-')
console.log('随口问 ' + cases.length + ' 题：头名 ' + t1 + '（' + pct(t1, cases.length) + '%）· 前五 ' + t5 + '（' + pct(t5, cases.length) + '%）· 全没 ' + miss)