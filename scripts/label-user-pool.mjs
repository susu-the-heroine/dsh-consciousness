/**
 * 给他的真话打初标（弱监督，之后人工抽查）
 * =====================================
 *
 * 规则只用「无争议写法」：
 *   op   —— 明确要东西：「帮我/给我/推荐/教我/写个/做个/列个/怎么/如何/能不能…」
 *   narr —— 明确说事：「上次/那天/当时/后来/我记得/刚才/前几天…」或完成体结尾
 *   其余一律 unknown（宁可不判，也别猜）
 *
 * 输出 scripts/data/intent-user-labeled.json，带 src='rule'，供抽查后再训。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const pool = JSON.parse(readFileSync(join(HERE, 'data', 'intent-user-pool.json'), 'utf8')).cases

const OP = /(帮我|给我|推荐|教我|写个|写一|做个|列个|起个|找个|改一下|改成|加个|删掉|怎么|如何|能不能|可不可以|要不要|多少钱|哪里|哪个|有没有)/
const NARR = /(上次|上回|那天|那次|当时|后来|之前|以前|前天|昨天|刚才|刚刚|我记得|你说过|不是.*吗|了$|过$)/
const NEG_QUESTION = /[?？]$/

function label(q) {
  if (OP.test(q) && !NARR.test(q)) return 'op'
  if (NARR.test(q) && !OP.test(q)) return 'narr'
  if (OP.test(q) && NARR.test(q)) return 'unknown'
  return 'unknown'
}

const cases = pool.map((c) => ({ q: c.q, y: label(c.q), src: 'rule' }))
const stat = { op: 0, narr: 0, unknown: 0 }
for (const c of cases) stat[c.y]++

writeFileSync(join(HERE, 'data', 'intent-user-labeled.json'), JSON.stringify({
  note: '他的真话（335 条）初标：规则打的，src=rule；人工抽查后改 y 再训',
  stat, cases,
}, null, 1))

console.log('初标完成', JSON.stringify(stat))

// 2026-11-21：这批规则对真话的覆盖太薄——三百三十五条里二百八十一条落在 unknown，
// 也就是八成四是没判的。这样一份「初标」拿去训，等于拿沉默当数据。
// 不拦，但把这话说在输出里，别让下一个窗口看着数字好看就下结论。
const total = cases.length || 1
const unknownPct = Math.round((stat.unknown / total) * 100)
if (unknownPct >= 70) {
  console.log(`注意：${stat.unknown}/${total}（${unknownPct}%）没判出来。这套规则对真话的覆盖就这么宽，`)
  console.log('拿去训之前先人工抽查；别把 unknown 当成「不是这两类」。')
}
// 顺带清掉一处死代码：NEG_QUESTION 定了没用过（原来大概想拿问号单独判，后来没接上）。

