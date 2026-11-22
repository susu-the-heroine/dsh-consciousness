/**
 * 意图分类验收
 * ============
 * 拿标注集跑规则分类器，看准确率。验收线 >=85% 才准接进注入。
 * 跑法：node scripts/eval-intent.mjs
 */
import { readFileSync , existsSync} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const { classifyIntent } = await import(
  'file:///' + join(HERE, '..', 'lib', 'intent.js').replace(/\\/g, '/') + '?v=' + Date.now()
)

const setPath = join(HERE, 'data', 'intent-set.json')
if (!existsSync(setPath)) {
  // 2026-11-15 凌晨我误删了 scripts/data，这份标注集没处捞。
  // 宁可明确报缺，也不让脚本崩在半截——更不能凭记忆重造编号。
  console.log('缺标注集：scripts/data/intent-set.json')
  console.log('做法：用真实问法重新标。题库先跑 node scripts/build-query-bank.mjs，')
  console.log('      再按 { cases: [{ q, y: "op"|"narr"|"unknown" }] } 存回去。别猜。')
  process.exit(1)
}
// 2026-11-21：原来只跑 intent-set.json 那一份。实测它 38 条里 34 条是说不清，
// 两边倒的题各只有两条——分数再高也证明不了「要东西」和「说事」分得开。
// 改成把所有带标签的集子都量一遍，任何一份低于验收线就判不过。
const SETS = ['intent-set.json', 'intent-set-v2.json', 'intent-user-labeled.json']

function load(f) {
  const fp = join(HERE, 'data', f)
  if (!existsSync(fp)) return null
  try {
    const j = JSON.parse(readFileSync(fp, 'utf8').replace(/^\uFEFF/, ''))
    const arr = Array.isArray(j) ? j : (j.cases || [])
    return arr.filter((c) => c && c.q && c.y)
  } catch { return null }
}

let anyFail = false
let anyRan = false
for (const f of SETS) {
  const cases = load(f)
  if (!cases || !cases.length) continue
  anyRan = true
  let right = 0
  const wrong = []
  const byLabel = {}
  for (const c of cases) {
    const got = classifyIntent(c.q)
    byLabel[c.y] = byLabel[c.y] || { n: 0, ok: 0 }
    byLabel[c.y].n++
    if (got === c.y) { right++; byLabel[c.y].ok++ }
    else wrong.push({ q: c.q, want: c.y, got })
  }
  const acc = right / cases.length
  // 2026-11-21：原来只看总准确率。三份集子里「说不清」占绝大多数，随口全判说不清
  // 也能九成上下——实测 user-labeled 那份总准确率 91.3% 判「过」，可「要东西」那一臂只有 39%。
  // 这条验收要看的是「要东西 vs 说事」分不分得开，所以每个标签都得自己过线。
  const labels = Object.keys(byLabel)
  const weak = labels.filter((k) => byLabel[k].ok / byLabel[k].n < 0.85)
  const pass = acc >= 0.85 && weak.length === 0
  if (!pass) anyFail = true
  console.log('【' + f + '】' + cases.length + ' 条 · 准确率 ' + (acc * 100).toFixed(1) + '%（' + right + '/' + cases.length + '） · ' + (pass ? '过' : '没过'))
  if (weak.length) console.log('  卡在每个标签都得过 85%：' + weak.map((k) => k + ' ' + ((byLabel[k].ok / byLabel[k].n) * 100).toFixed(0) + '%').join(' · '))
  const dist = Object.keys(byLabel).map((k) => k + ' ' + byLabel[k].ok + '/' + byLabel[k].n).join(' · ')
  console.log('  各标签：' + dist)
  if (wrong.length) {
    for (const w of wrong.slice(0, 8)) console.log('  [' + w.want + '→' + w.got + '] ' + w.q)
    if (wrong.length > 8) console.log('  …还有 ' + (wrong.length - 8) + ' 条')
  }
  console.log('')
}
if (!anyRan) { console.log('一份带标签的集子都没读到'); process.exit(1) }
console.log(anyFail ? '结论：有集子没过 85%，这条验收红着——不是回归，是本来就没达标。' : '结论：全部过 85%。')
process.exit(anyFail ? 1 : 0)
