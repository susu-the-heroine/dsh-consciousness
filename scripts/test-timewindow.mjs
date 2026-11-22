/**
 * 时间窗标记 · 正反自测
 *
 * 小跨度（昨天/上周/上个月）要硬过滤；大跨度（去年/前年）只当参考。
 * 标记不准，过滤就会瞎做——所以先钉标记。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const P = await import(LIB + '/parse.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}
const f = (q) => {
  const w = P.parseTimeWindow(q)
  return w ? w.fuzzy : null
}

t('昨天：硬过滤', f('昨天那条鱼') === false, String(f('昨天那条鱼')))
t('上周：硬过滤', f('上周那条鱼') === false, String(f('上周那条鱼')))
t('去年：只当参考', f('去年冬天那条鱼') === true, String(f('去年冬天那条鱼')))
t('前年：只当参考', f('前年那条鱼') === true, String(f('前年那条鱼')))
t('没时间词：返回 null', f('那条鱼') === null)

const w = P.parseTimeWindow('昨天那条鱼')
t('时间词从查询里抠掉', w && !String(w.rest).includes('昨天'), w && w.rest)

console.log(`时间窗标记：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
