/**
 * 养三十天：往沙箱海里按天喂，量每个阶段库里长出了什么
 * ====================================================
 *
 * 说清楚它测什么、不测什么：
 *   测：条数、别名覆盖、带数字的具体事、规矩条数、实体覆盖、平均长度——
 *       这些是"她能不能像那个人"的原料。
 *   不测：她答得像不像。那要模型真的说话，脚本替不了。
 *
 * 为什么这么干：别人的她是从空白养起来的。空白库里没有这些东西，
 * 她就是个没料的人；有料了才谈得上像不像。
 *
 * 跑法：
 *   node scripts/grow30.mjs               干跑，只报数
 *   node scripts/grow30.mjs --write       真写进沙箱海 grow30
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = join(homedir(), '.dsh', 'consciousness-seas')
const write = process.argv.includes('--write')

const src = join(BASE, 'main', 'data.json')
if (!existsSync(src)) {
  console.log('没有主库，先随便写几条再来。')
  process.exit(1)
}
const all = JSON.parse(readFileSync(src, 'utf8').replace(/^\uFEFF/, '')).points
  .filter((p) => !p.dead && !p.validUntil)

// 三阶段：5 / 30 / 90 条。先从主库取样，模拟"这个人越写越多"。
const stages = [5, 30, 90]

function stats(list) {
  const n = list.length || 1
  const has = (k) => list.filter((x) => String(x[k] || '').trim()).length
  const withNum = list.filter((x) => /\d/.test(String(x.text || ''))).length
  const rules = list.filter((x) => x.rule === true).length
  const ents = list.filter((x) => Array.isArray(x.entities) && x.entities.length).length
  const avg = Math.round(list.reduce((a, x) => a + String(x.text || '').length, 0) / n)
  return {
    条数: list.length,
    别名: Math.round((has('alias') / n) * 100),
    带数字的具体事: Math.round((withNum / n) * 100),
    有实体: Math.round((ents / n) * 100),
    规矩: rules,
    正文均长: avg,
  }
}

// 取样：按时间从早到晚取，模拟真实生长顺序
const ordered = [...all].sort((a, b) => {
  const t = (x) => {
    const v = x.lastSeen || x.born || 0
    return typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v)) || 0
  }
  return t(a) - t(b)
})

console.log('')
console.log('养三十天 · 原料体检（不是人格评分）')
console.log('──────────────────────────────────────────────')
console.log('阶段'.padEnd(10), '条数'.padEnd(6), '别名%'.padEnd(7), '具体事%'.padEnd(8), '实体%'.padEnd(7), '规矩', '均长')
for (const s of stages) {
  const slice = ordered.slice(0, Math.min(s, ordered.length))
  const st = stats(slice)
  console.log(
    ('第' + s + '条').padEnd(9),
    String(st.条数).padEnd(6),
    String(st.别名).padEnd(8),
    String(st.带数字的具体事).padEnd(9),
    String(st.有实体).padEnd(8),
    String(st.规矩).padEnd(4),
    st.正文均长
  )
}
console.log('')
console.log('怎么读这张表：')
console.log('  别名低 → 换个说法就问不到，她像个没被介绍过的人。')
console.log('  具体事低 → 记的都是感想，问细节全塌，像背台词的。')
console.log('  规矩 0 → 她没有底线，谁来都能推着走。')
console.log('')

if (write) {
  const dir = join(BASE, 'grow30')
  mkdirSync(dir, { recursive: true })
  const slice = ordered.slice(0, Math.min(90, ordered.length)).map((x, i) => ({ ...x, id: 800000 + i }))
  // 2026-11-21：这个沙箱海一旦写起来，第二次跑就直接盖掉上一次的 90 条。
  // 今晚已经因为「照着默认路径就往里写」栽过一次，这条也上闸：已经有库、又没加 --force，就不盖。
  const target = join(dir, 'data.json')
  if (existsSync(target) && !process.argv.includes('--force')) {
    console.log('沙箱海里已经有 data.json：' + target)
    console.log('不覆盖。确认要盖，加 --force；或者先把那份挪走。')
    process.exit(3)
  }
  writeFileSync(target, JSON.stringify({ points: slice, edges: [] }, null, 1), 'utf8')
  console.log('已写进沙箱海 grow30（' + slice.length + ' 条），主库没动。')
}
