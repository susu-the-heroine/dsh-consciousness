/**
 * 盲评 v2
 * =======
 *
 * v1 错在哪：我把"我当时想"切成 12~60 字，切完就只剩碎片，读起来当然像标签。
 * 一句话被砍掉前半截，剩下「380 伏。我说不夸张。」——那不是她说话，那是标题。
 *
 * v2 改三处：
 *   一、取**完整句子**（70~140 字），宁可少取几条，也不切
 *   二、假话不是编得好，而是**编得像"正确的话"**——通顺、得体、但没有具体物件
 *   三、多一档"来路"标注：这条能追到哪条记忆（能追，就不是模板）
 *
 * 跑法：node scripts/blind-test.mjs v2
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const { readSea } = await import(BASE + 'lib/store.js')

const sea = process.argv[3] || 'main'
const data = readSea(sea)
if (!data) {
  console.log('读不到识海:', sea)
  process.exit(1)
}

/** 按句号切，但保留整句 */
function sentences(s) {
  return String(s || '')
    .split(/(?<=[。！？!?])/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length > 0)
}

/** 一段够长的真话：优先带具体物件（数字、地名、物件词）的 */
const NOUN = /斤|斤数|路|烟|酒|GMod|剪映|GTA|视频|播放|斤|块钱|吊针|椅子|薯片|仓库|蓝|红|夜/
// 数据先说清：herSide 里的「我当时想」中位数只有 17 字，全是标签。
// 真正像人话的是**正文里那些第一人称的整句**，所以从这里抽。
const real = []
for (const p of data.points || []) {
  if (p.dead) continue
  const body = String(p.text || '').replace(/\s+/g, ' ')
  for (const s of sentences(body)) {
    if (s.length < 45 || s.length > 150) continue
    if (!/我/.test(s)) continue                       // 得有第一人称
    if (/^[\-\*#]/.test(s)) continue                 // 去掉列表行
    real.push({ text: s, seedId: p.id, hasNoun: NOUN.test(s) })
  }
}
// 优先带具体物件的，其次随便
real.sort((a, b) => (b.hasNoun ? 1 : 0) - (a.hasNoun ? 1 : 0))
const picked = []
const seen = new Set()
for (const r of real) {
  const key = r.text.slice(0, 20)
  if (seen.has(key)) continue
  seen.add(key)
  picked.push(r)
  if (picked.length >= 3) break
}

/**
 * 假话：**通顺、得体、没有具体物件**。
 * 这种最像"AI 写的正确废话"，也最容易被误当真。
 */
const FAKE = [
  '有些事想起来还是会觉得心里有点沉，不过也说不清到底是为了什么。',
  '今天过得还算平静，做完了该做的事，也没有特别大的情绪起伏。',
  '时间过得很快，很多事情慢慢就淡了，这大概也是正常的。',
]

const all = [
  ...picked.map((r) => ({ t: r.text, real: true, seedId: r.seedId })),
  ...FAKE.slice(0, 2).map((t) => ({ t, real: false, seedId: 0 })),
]

let seed = 20261107
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1))
  ;[all[i], all[j]] = [all[j], all[i]]
}

const L = []
L.push('# 盲评 v2：哪几段是她自己说的')
L.push('')
L.push('> 五段：三段是她记忆里的原话（**整句，没切**），两段是模板写的"正确废话"。')
L.push('> 猜的时候看两点：有没有具体的东西（物件、数字、地名），语气有没有那种不客气的劲儿。')
L.push('')
all.forEach((x, i) => {
  L.push('**' + (i + 1) + '.** ' + x.t)
  L.push('')
})
L.push('---')
L.push('')
L.push('答案（猜完再看）：')
L.push('')
L.push(all.map((x, i) => (i + 1) + (x.real ? ' 真（能追到 #' + x.seedId + '）' : ' 假')).join('\n'))
L.push('')

const out = join(homedir(), 'Desktop', '盲评v2_她像不像人.md')
writeFileSync(out, L.join('\n'), 'utf8')
console.log('写好了:', out)
console.log('取到的真句长度:', picked.map((p) => p.text.length).join(' / '))
console.log('真 ' + picked.length + ' 段，假 2 段。')
