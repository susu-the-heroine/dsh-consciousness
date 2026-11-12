/**
 * 注入回指率：前面说过的话，后面几轮的注入里还在不在。
 *
 * 为什么这么量（2026-11-08）：
 *   之前的"答非所问/改口没跟上"是子智能体扮演她的毛病，不是插件的。
 *   插件能负责的只有一件事：**该记的那条，有没有出现在注入里。**
 *
 * 量三处：
 *   回指（第2轮看第1轮的细节）：第1轮他那句话的二元组，在第2轮注入里命中多少
 *   改口（第5轮看第4轮的新说法）：同法
 *   记性（第6轮看第1轮）：同法
 *
 * 用法：node scripts/inject-recall.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DIR = join(homedir(), '.dsh', 'deep')
if (!existsSync(DIR)) { console.log('还没有深度测试数据'); process.exit(0) }

const STOP = new Set('我们 你们 他们 这个 那个 什么 一个 就是 没有 自己 时候 东西 所以 因为 但是 如果 然后 已经 还是 可以 不是 现在 今天 真的 知道 觉得 有点 这样 那样'.split(' '))

function bigrams(s) {
  const cjk = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const out = new Set()
  for (let i = 0; i < cjk.length - 1; i++) {
    const b = cjk.slice(i, i + 2)
    if (!STOP.has(b)) out.add(b)
  }
  return out
}

function overlap(src, dst) {
  const a = bigrams(src), b = bigrams(dst)
  if (!a.size) return null
  let hit = 0
  for (const x of a) if (b.has(x)) hit++
  return hit / a.size
}

const rows = []
for (const f of readdirSync(DIR).filter((n) => /^t\d+\.jsonl$/.test(n))) {
  const list = []
  for (const line of readFileSync(join(DIR, f), 'utf8').split('\n')) {
    const t = line.replace(/^\uFEFF/, '').trim()
    if (!t) continue
    try { list.push(JSON.parse(t)) } catch {}
  }
  const byUser = new Map()
  for (const r of list) {
    if (!byUser.has(r.u)) byUser.set(r.u, [])
    byUser.get(r.u).push(r)
  }
  for (const [u, turns] of byUser) {
    turns.sort((a, b) => a.turn - b.turn)
    const get = (n) => turns.find((x) => Number(x.turn) === n) || null
    const t1 = get(1), t2 = get(2), t4 = get(4), t5 = get(5), t6 = get(6)
    if (t1 && t2) {
      const v = overlap(t1.him, t2.inj)
      if (v !== null) rows.push({ file: f, u, kind: '回指(2看1)', v })
    }
    if (t4 && t5) {
      const v = overlap(t4.him, t5.inj)
      if (v !== null) rows.push({ file: f, u, kind: '改口(5看4)', v })
    }
    if (t1 && t6) {
      const v = overlap(t1.him, t6.inj)
      if (v !== null) rows.push({ file: f, u, kind: '记性(6看1)', v })
    }
  }
}

if (!rows.length) { console.log('没有可算的成对轮次'); process.exit(0) }

const kinds = [...new Set(rows.map((r) => r.kind))]
console.log(`算了 ${rows.length} 对｜文件 ${new Set(rows.map((r) => r.file)).size} 份`)
for (const k of kinds) {
  const xs = rows.filter((r) => r.kind === k).map((r) => r.v)
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length
  const miss = xs.filter((v) => v < 0.25).length
  const good = xs.filter((v) => v >= 0.5).length
  console.log(`${k}：${xs.length} 对｜平均重合 ${(avg * 100).toFixed(0)}%｜≥50% 的 ${good} 对｜<25% 的 ${miss} 对`)
}
console.log('\n口径：重合度是"他那句话的两字组合有多少出现在这轮注入里"。低于 25% 就算她没记住。')
