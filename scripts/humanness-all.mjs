/**
 * 像人评测 · 一键全跑
 * ====================
 *   node scripts/humanness-all.mjs
 *
 * 把现在能跑的几项串起来，一次出数、写到 docs/像人评测-最新.md：
 *   1. 功能四项（越级/编造/追问新增/近邻误命中）
 *   2. 长程接续（30 段）
 *   3. 模板复用（拿对话级 A 侧当样本）
 *
 * 不跑的东西也写清楚：对话级盲测要人评，脚本只负责出题和算分。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const node = process.execPath
const run = (script, args = []) => {
  try {
    return execFileSync(node, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 900000 })
  } catch (e) {
    return String((e && e.stdout) || '') + '\n' + String((e && e.stderr) || '')
  }
}

const grab = (text, re) => { const m = String(text).match(re); return m ? m[1] : '?' }

const gates = run('scripts/eval-gates.mjs')
const replay = run('scripts/replay-longrange.mjs')

// 模板复用：从对话级题里抽 A 侧
let dup = '未跑'
const qFile = 'docs/对话级盲测-10组.md'
if (existsSync(qFile)) {
  const a = readFileSync(qFile, 'utf8').split('\n').filter((l) => l.startsWith('A. ')).map((l) => l.slice(3))
  const tmp = process.env.TEMP + '/humanness-a.txt'
  writeFileSync(tmp, a.join('\n'), 'utf8')
  dup = grab(run('scripts/dup-reply.mjs', [tmp]), /复用 \d+（([\d.]+%)）/)
}

const rows = [
  ['越级率', grab(gates, /A1 越级率：[^\n]*?（([\d.]+%)）/)],
  ['编造率', grab(gates, /C1 编造率：[^\n]*?（([\d.]+%)）/)],
  ['追问新增', grab(gates, /C2 追问新增：[^\n]*?(\d+\/\d+)/)],
  ['近邻误命中', grab(gates, /B2 近邻误命中：[^\n]*?（([\d.]+%)）/)],
  ['长程接续', grab(replay, /接上 \d+（([\d.]+%)）/)],
  ['模板复用', dup],
]

const out = ['# 像人评测 · 最新一次', '', '| 项 | 数 |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`), '',
  '对话级盲测（人评）不在脚本里：出题看 docs/对话级盲测-10组.md，评分用答案键对。',
  '单句盲测三版全输（2/20、0/20、0/20），主场口径是对话级。']
writeFileSync('docs/像人评测-最新.md', out.join('\n') + '\n', 'utf8')

console.log('  ' + rows.map(([k, v]) => k + ' ' + v).join(' · '))
console.log('  明细：docs/像人评测-最新.md')
