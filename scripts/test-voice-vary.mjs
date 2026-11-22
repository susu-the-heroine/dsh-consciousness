/**
 * 说法会变，事实不变
 * ================
 *
 *   node scripts/test-voice-vary.mjs
 *
 * 正面：同一个问题，隔天再问，开口那句会换（像人回忆不是背稿子）
 * 反面：同一天问两次，说法不许抽风；换说法时，底下的事实、条数、顺序一个字不许动
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { openLineFor, searchTool } = await import(LIB + '/tools.js')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const day = 86400000
const base = Date.UTC(2026, 10, 16)
const q = '显卡那件事'

// 正面一：同一天不变
const sameDay = new Set([0, 1, 2, 5].map((h) => openLineFor(q, 3, base + h * 3600000)))
check('同一天说法一致', sameDay.size === 1, [...sameDay].join(' / '))

// 正面二：两周内至少换过两种说法
const vary = new Set()
for (let d = 0; d < 14; d++) vary.add(openLineFor(q, 3, base + d * day))
check('隔天会换说法', vary.size >= 2, [...vary].join(' | '))

// 正面三：不管怎么换，问句和条数都在
const allOk = [...vary].every((s) => s.includes(q) && s.includes('3'))
check('说法里问句与条数都在', allOk)

// 反面：检索结果只许第一行动，其余逐字相同
const a = await searchTool.execute({ query: q, limit: 3, review: false })
const b = await searchTool.execute({ query: q, limit: 3, review: false })
const body = (r) => String(r.log).split('\n').slice(1).join('\n')
check('两次检索正文逐字相同', body(a) === body(b))

const head = String(a.log).split('\n')[0]
check('第一行确实是那句开口', head.includes(q) && head.includes('条') || head.includes('件'), head)

console.log(`\n说法自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
