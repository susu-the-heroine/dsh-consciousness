/**
 * 意图分类三方对照：规则 vs 小模型 vs 混合
 * ======================================
 *
 *   node scripts/eval-intent2.mjs
 *
 * 数据：scripts/data/intent-set-v2.json（150 条，三类各 50，人工标）
 * 输出：三者的准确率、混淆、以及规则错模型对的例子（说明模型到底补了什么）
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(HERE, 'data', 'intent-set-v2.json'), 'utf8')).cases
const { classifyIntent } = await import('file:///' + join(HERE, '..', 'lib', 'intent.js').replace(/\\/g, '/'))
const { classify2, classifyIntent2 } = await import('file:///' + join(HERE, '..', 'lib', 'intent2.js').replace(/\\/g, '/') + '?v=' + Date.now())

const stat = { rule: 0, model: 0, hybrid: 0 }
const ruleRightModelWrong = []
const ruleWrongModelRight = []
for (const c of cases) {
  const r = classifyIntent(c.q)
  const m = classify2(c.q).label
  const h = classifyIntent2(c.q)
  if (r === c.y) stat.rule++
  if (m === c.y) stat.model++
  if (h === c.y) stat.hybrid++
  if (r === c.y && m !== c.y) ruleRightModelWrong.push(`${c.q}（标${c.y}/规${r}/模${m}）`)
  if (r !== c.y && m === c.y) ruleWrongModelRight.push(`${c.q}（标${c.y}/规${r}/模${m}）`)
}

const n = cases.length
console.log(`样本 ${n}（三类各 50）——注意：下面是**训练集自评**，只作 sanity check；泛化看 scripts/intent-train.mjs 的 5 折（92.7%）`)
console.log(`  规则   ${(stat.rule / n * 100).toFixed(1)}%  ${stat.rule}/${n}`)
console.log(`  小模型 ${(stat.model / n * 100).toFixed(1)}%  ${stat.model}/${n}`)
// 2026-11-21：这一栏原来叫「混合」，看代码才知道它只是「模型 + 置信闸 0.4」，
// 里面一条规则都没有。叫混合会让人以为「规则+模型拼起来更准」——那是假结论。
console.log(`  模型·置信闸0.4   ${(stat.hybrid / n * 100).toFixed(1)}%  ${stat.hybrid}/${n}   （里面没有规则，别当混合看）`)
console.log(`\n模型补对的（规则错）：${ruleWrongModelRight.length} 条`)
for (const x of ruleWrongModelRight.slice(0, 8)) console.log('  + ' + x)
console.log(`\n模型弄错的（规则对）：${ruleRightModelWrong.length} 条`)
for (const x of ruleRightModelWrong.slice(0, 8)) console.log('  - ' + x)
console.log(`\n结论：混合${stat.hybrid >= stat.rule ? '不差于' : '差于'}规则；模型单独${stat.model >= stat.rule ? '优于' : '不及'}规则。`)
