#!/usr/bin/env node
/**
 * 人味一条命令
 * ============
 *   node scripts/humanness.mjs [要扫的文件...]
 *
 * 不带参数时：扫三批人格一致率答案 + 找最近的两批做一致率对比。
 * 带参数时：只扫你给的文件（用来发前自检）。
 *
 * 干的四件事：
 *   1 过一遍 AI 味扫描（ai-smell）
 *   2 有连续两批答案就比人格一致率（persona-drift）
 *   3 报当前注入那句原文，确认没被谁改回去
 *   4 不跑 guard（那个慢，改 lib 时才跑）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HERE = process.cwd()
const NODE = process.execPath
const run = (args) => {
  try { return execFileSync(NODE, args, { cwd: HERE, encoding: 'utf8' }) } catch (e) { return String(e.stdout || e.message) }
}

const given = process.argv.slice(2)
const smoke = given.length
  ? given
  : ['docs/人格一致率-第一批.md', 'docs/人格一致率-第三批.md', 'docs/人格一致率-第四批.md'].filter((f) => existsSync(join(HERE, f)))

console.log('\n一、AI 味扫描')
for (const f of smoke) {
  const out = run(['scripts/ai-smell.mjs', f])
  for (const line of out.split('\n').filter((l) => l.includes('带 AI 味'))) console.log('  ' + line.trim())
  // 给了自己的文件，就顺手跑一遍自动去味，报改前改后
  if (given.length) {
    const tmp = join(HERE, 'docs', '.clean-tmp.md')
    run(['scripts/clean-reply.mjs', f, '--out', tmp])
    const after = run(['scripts/ai-smell.mjs', tmp])
    for (const line of after.split('\n').filter((l) => l.includes('带 AI 味'))) console.log('  自动去味后 → ' + line.trim())
  }
}

console.log('\n二、人格一致率')
const count = (f) => readFileSync(join(HERE, 'docs', f), 'utf8').split('\n').filter((l) => /^\d+\. /.test(l)).length
// 按修改时间排，不按文件名：中文序会把「第四批」排到「第六批」后面
const all = readdirSync(join(HERE, 'docs'))
  .filter((f) => /^人格一致率-第.+批\.md$/.test(f))
  .map((f) => [f, statSync(join(HERE, 'docs', f)).mtimeMs])
  .sort((a, b) => a[1] - b[1])
  .map(([f]) => f)
// 只比同题量的两批：不同题量比出来的数是假的（十问对三十问只有 54）
const maxN = Math.max(0, ...all.map(count))
const batches = all.filter((f) => count(f) === maxN)
if (batches.length >= 2) {
  const [a, b] = batches.slice(-2)
  const out = run(['scripts/persona-drift.mjs', 'docs/' + a, 'docs/' + b])
  const score = out.split('\n').filter((l) => l.includes('人格一致率')).pop()
  console.log('  ' + a + ' vs ' + b)
  console.log('  ' + (score || '').trim())
} else {
  console.log('  同一题量的答案只有 ' + batches.length + ' 批（' + maxN + ' 问），还比不了')
}

console.log('\n三、注入现行那句')
const inj = readFileSync(join(HERE, 'lib/inject.js'), 'utf8')
const m = inj.match(/回话给一个具体数[^']*/)
console.log('  ' + (m ? m[0] : '（没找到，可能被改回去了）'))

console.log('\n四、提醒')
console.log('  改过 lib/*.js 就跑 node scripts/guard.mjs，四套必须都在底线以上。')
