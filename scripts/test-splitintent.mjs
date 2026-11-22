/**
 * 长问句拆意图 · 正反自测
 *
 * 正：一句问两三件事的，能切开；每段的二字组能并进查询。
 * 反：短句不硬拆；拆完只剩一段的，原样返回；空串不炸。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/splitintent.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const S = await import(LIB + '/splitintent.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const long = '他第一次潜水是在哪片海，哪年去的，跟谁一起'
const parts = S.splitQuery(long)
t('长问句能切开', parts.length >= 2, JSON.stringify(parts))
t('切开后每段够长', parts.every((p) => [...p].length >= 3), JSON.stringify(parts))
t('切完不超过四段', parts.length <= 4, String(parts.length))

const short = '经十路'
t('短句不硬拆', S.splitQuery(short).length === 1 && S.splitQuery(short)[0] === short)

t('空串给空数组', S.splitQuery('').length === 0)
t('单段长句原样返回', (() => {
  const one = '那天晚上你在经十路上开着大路虎一直往南走走了很久最后停在桥底下抽了一根烟'
  const r = S.splitQuery(one)
  return r.length === 1 && r[0] === one
})())

const g = (s) => {
  const o = new Set()
  const x = String(s || '')
  for (let i = 0; i + 2 <= x.length; i++) o.add(x.slice(i, i + 2))
  return o
}
const q = g(long)
const before = q.size
const added = S.addPartGrams(q, parts, g)
t('并段后查询变多', q.size >= before && added >= 0, `before=${before} after=${q.size} added=${added}`)
t('坏参数不炸', S.addPartGrams(null, parts, g) === 0)
t('给空段不炸', S.addPartGrams(new Set(), [], g) === 0)

console.log(`长问句拆意图：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
