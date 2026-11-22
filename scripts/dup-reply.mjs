/**
 * 模板复用检测（防「同一套话换个问法再说一遍」）
 * ================================================
 *   node scripts/dup-reply.mjs [文件...]
 *
 * 无参数时：先读流水里 who=me 的回复；没有就退回 docs/我的回复-20条.md。
 * 口径：
 *   把每条切成 8 字滑窗（去标点），两条不同回复之间共享的窗口算复用。
 *   复用率 = 被复用的窗口数 / 总窗口数。
 *   单条内部重复不算（同一句里重复词是口癖，不是模板）。
 *
 * 为什么量这个：对话级盲测评者指出「第 2 组和第 9 组近逐字重复」——
 * 人被问两遍会重复意思，不会整句复制。整句复制是最硬的机器痕迹。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SHINGLE = 8

const clean = (s) => String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
const shingles = (s) => {
  const t = clean(s)
  const out = new Set()
  for (let i = 0; i + SHINGLE <= t.length; i++) out.add(t.slice(i, i + SHINGLE))
  return out
}

function fromRaw() {
  const dir = join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', 'main', 'raw')
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!l) continue
      try {
        const o = JSON.parse(l)
        if (o.who === 'me' && String(o.text || '').trim().length > 10) out.push(String(o.text))
      } catch {}
    }
  }
  return out
}

function fromDoc() {
  const p = 'docs/我的回复-20条.md'
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n')
    .filter((l) => /^\d+\. /.test(l))
    .map((l) => l.replace(/^\d+\.\s*/, ''))
}

const texts = process.argv.length > 2
  ? process.argv.slice(2).flatMap((p) => readFileSync(p, 'utf8').split('\n').filter(Boolean))
  : (fromRaw().length ? fromRaw() : fromDoc())

if (!texts.length) {
  console.log('  没有可测的回复（流水里 me 还是 0 条）')
  process.exit(0)
}

const sets = texts.map(shingles)
const seen = new Map()
let total = 0
let shared = 0
const pairs = []
sets.forEach((set, i) => {
  for (const g of set) {
    total++
    if (seen.has(g) && seen.get(g) !== i) {
      shared++
      const prev = seen.get(g)
      if (pairs.length < 8) pairs.push('「' + g + '」出现在第 ' + (prev + 1) + ' 和第 ' + (i + 1) + ' 条')
    } else if (!seen.has(g)) seen.set(g, i)
  }
})

const pct = ((shared / total) * 100).toFixed(2)
console.log('  样本 ' + texts.length + ' 条 · 窗口 ' + total + ' · 复用 ' + shared + '（' + pct + '%）')
if (pairs.length) { console.log('  例子：'); pairs.forEach((x) => console.log('    ' + x)) }
