/**
 * 盲评：她到底像不像人
 * ====================
 *
 * 所有单测只能证明"数值和结构对"，证明不了"像人"。
 * 唯一能测像不像的办法：**让人猜**。
 *
 * 做法：拿五段独白 —— 三段是她自己的真话（从记忆的双向字段里取），
 * 两段是模板拼的。打乱顺序，让人猜哪几段是真的。
 * 猜不出来，才算过。
 *
 * 跑法：node scripts/blind-test.mjs  → 输出桌面上的一个 md
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const { readSea } = await import(BASE + 'lib/store.js')

const sea = process.argv[2] || 'main'
const data = readSea(sea)
if (!data) {
  console.log('读不到识海:', sea)
  process.exit(1)
}

/** 真话：她自己那一半（herSide.felt / herSide.regret） */
const real = []
for (const p of data.points || []) {
  if (p.dead) continue
  const hs = p.herSide || {}
  const felt = String(hs.felt || '').trim()
  if (felt.length >= 12 && felt.length <= 60) real.push(felt)
}
// 不够就用"我当时想"
if (real.length < 3) {
  for (const p of data.points || []) {
    const hs = p.herSide || {}
    const felt = String(hs.felt || '').trim()
    if (felt && !real.includes(felt)) real.push(felt)
  }
}
const picked = real.slice(0, 3)

/** 假话：模板拼的。刻意写得像，但它是拼的 */
const FAKE = [
  '今天有点累，不过还算踏实，事情做完了一件。',
  '外面安静下来了，我坐了一会儿，什么都没想。',
  '有些话没来得及说，想想也就算了。',
]

const all = [
  ...picked.map((t) => ({ t, real: true })),
  ...FAKE.slice(0, 2).map((t) => ({ t, real: false })),
]

// 打乱：用固定种子，保证每次跑同一个顺序（可复现）
let seed = 20261107
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1))
  ;[all[i], all[j]] = [all[j], all[i]]
}

const lines = []
lines.push('# 盲评：哪几段是她自己说的')
lines.push('')
lines.push('> 五段里，三段是从她记忆里的「我当时想」原样取的，两段是模板拼的。')
lines.push('> 猜出哪三段是真的，写下来；猜不出，说明这一版够像人。')
lines.push('')
all.forEach((x, i) => {
  lines.push('**' + (i + 1) + '.** ' + x.t)
  lines.push('')
})
lines.push('---')
lines.push('')
lines.push('答案（先别看，猜完再对）：')
lines.push('')
lines.push(all.map((x, i) => (i + 1) + (x.real ? ' 真' : ' 假')).join(' · '))
lines.push('')

const out = join(homedir(), 'Desktop', '盲评_她像不像人.md')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log('写好了:', out)
console.log('五段：真 ' + picked.length + ' 段，假 2 段。')
