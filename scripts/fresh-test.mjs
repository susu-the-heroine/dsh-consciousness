/**
 * 新旧打架 · 自动出题 + 判定（2026-11-20 夜）
 * ==========================================
 *   node scripts/fresh-test.mjs
 *
 * 题库从库里现生成：找两条都带「万/亿」数字、又共享若干二字组的记忆，
 * 新的一条算「现在的答案」。问题只问那件事现在多少，判据是：
 * 搜索结果的前三行里得出现「新数字」，且「按记载最大」那条别指到旧的那条。
 *
 * 退出码 0 = 全过；1 = 有几道取成了旧的。
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEA = join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json')
const data = JSON.parse(readFileSync(SEA, 'utf8'))
const live = (data.points || []).filter((p) => !p.dead && !p.archived)

const numOf = (t) => {
  const m = String(t).match(/([0-9]+(?:\.[0-9]+)?|[一二三四五六七八九十百千]+)\s*([万亿])/)
  if (!m) return 0
  const at = m.index || 0
  const win = String(t).slice(Math.max(0, at - 24), at + m[0].length + 24)
  if (!/播放|视频|跑了|跑出|涨|粉|观看|阅读/.test(win)) return 0
  const cn = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000 }
  let v = 0
  if (/^[0-9]/.test(m[1])) v = Number(m[1])
  else { let cur = 0; for (const ch of m[1]) { if (cn[ch] === undefined) continue; if (cn[ch] >= 10) cur = (cur || 1) * cn[ch]; else cur += cn[ch] } v = cur || 0 }
  return v * (m[2] === '万' ? 10000 : 100000000)
}
const grams = (t) => {
  const s = String(t).replace(/[\s，。？！、；：""''（）()]/g, '')
  const out = new Set()
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2))
  return out
}

const withNum = live.map((p) => ({ p, v: numOf(String(p.title || '') + ' ' + String(p.text || '')), g: grams(String(p.title || '') + String(p.text || '')) }))
  .filter((x) => x.v > 0)

const cases = []
for (let i = 0; i < withNum.length && cases.length < 20; i++) {
  for (let j = i + 1; j < withNum.length && cases.length < 20; j++) {
    const a = withNum[i]
    const b = withNum[j]
    if (!(Number(a.p.born) && Number(b.p.born))) continue
    const oldOne = Number(a.p.born) <= Number(b.p.born) ? a : b
    const newOne = oldOne === a ? b : a
    if (oldOne.v >= newOne.v) continue
    let shared = 0
    for (const g of oldOne.g) if (newOne.g.has(g)) shared++
    if (shared < 6) continue
    cases.push({ q: (String(newOne.p.title || '').slice(0, 12) || '那件事') + '现在是多少', newV: newOne.v, newId: newOne.p.id, oldV: oldOne.v, oldId: oldOne.p.id })
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'fresh-test-'))
mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })
cpSync(join(homedir(), '.dsh', 'consciousness-seas', 'main'), join(tmp, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
process.env.USERPROFILE = tmp
process.env.HOME = tmp
const { searchTool } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

const fmt = (v) => (v >= 100000000 ? v / 100000000 + ' 亿' : v >= 10000 ? v / 10000 + ' 万' : String(v))
let pass = 0
for (const c of cases) {
  const r = await searchTool.execute({ query: c.q, limit: 3, review: false })
  const head = String(r.log || '').split('\n').slice(0, 3).join('\n')
  // 判据改成看头名是谁：这类问句问的是「现在」，头名该落在新的那条上。
  const first = /· #(\d+)/.exec(head)
  const ok = first ? Number(first[1]) === c.newId : false
  if (ok) pass++
  else console.log(`  没过：${c.q}｜该 ${fmt(c.newV)}（#${c.newId}），实际首屏：${head.replace(/\n/g, ' / ').slice(0, 80)}`)
}
console.log(`新旧打架 ${cases.length} 题：过 ${pass} · 不过 ${cases.length - pass}`)
rmSync(tmp, { recursive: true, force: true })
process.exit(pass === cases.length ? 0 : 1)
