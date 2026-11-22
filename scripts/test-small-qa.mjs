/**
 * 小题库 · 切题与统计自测
 *
 * 正：三类各自能切出题、统计口径对。
 * 反：题不够时不硬凑；坏题（没 q 或没 want）不许进；地板是减两分。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/smallqa.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const S = await import(LIB + '/smallqa.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const mk = (q, want) => ({ q, want })
const cases = [
  mk('那个东西叫什么', 1),
  mk('那件事后来怎么样了', 2),
  mk('他说的那句话是啥', 3),
  mk('他没说过那句话吗', 4),
  mk('为什么不是他', 5),
  mk('并没有答应过吧', 6),
  mk('那天晚上你跟我说的那一段很长很长的话完完整整的版本是什么', 7),
  mk('还有一件特别长的事情我一直记不住想再问一次到底是怎么回事啊', 8),
  mk('', 9),
  mk('有 q 没 want', NaN),
]

const sets = S.pickCases(cases, 3)
t('指代题切得出来', sets.ref.length === 3, String(sets.ref.length))
t('否定题不混指代', sets.neg.every((c) => !/那个|那件事/.test(c.q)))
t('长问句按长度切', sets.long.every((c) => c.q.length >= 28))
t('坏题不进来', ![...sets.ref, ...sets.neg, ...sets.long].some((c) => !c.q || !Number.isFinite(Number(c.want))))

const small = S.pickCases([mk('那个东西', 1)], 5)
t('题不够不硬凑', small.ref.length === 1 && small.neg.length === 0, JSON.stringify(small))

// 统计
const sum = S.summarize([
  { rank: 1 }, { rank: 1 }, { rank: 2 }, { rank: 4 }, { rank: 0 },
])
t('头名算得对', sum.top1 === 40, String(sum.top1))
t('前三算得对', sum.top3 === 60, String(sum.top3))
t('空集不炸', S.summarize([]).n === 0)

// 地板
const fl = S.floorsOf({ ref: { top1: 40, top3: 60 } })
t('地板各减两分', fl.ref.top1 === 38 && fl.ref.top3 === 58, JSON.stringify(fl))
t('地板不为负', S.floorsOf({ ref: { top1: 1, top3: 0 } }).ref.top1 === 0)

console.log(`小题库：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
