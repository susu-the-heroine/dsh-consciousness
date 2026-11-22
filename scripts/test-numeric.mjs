/**
 * 数值归一 · 正反自测
 *
 * 正：一万三 → 13000、两万 → 20000、三千五 → 3500、2万 → 20000。
 * 反：认不出的、没有数字的，一律返回空；不许瞎猜。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/numeric.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const N = await import(LIB + '/numeric.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

t('一万三 = 13000', N.chineseToNumber('一万三') === 13000, String(N.chineseToNumber('一万三')))
t('两万 = 20000', N.chineseToNumber('两万') === 20000, String(N.chineseToNumber('两万')))
t('三千五 = 3500', N.chineseToNumber('三千五') === 3500, String(N.chineseToNumber('三千五')))
t('一万一 = 11000', N.chineseToNumber('一万一') === 11000, String(N.chineseToNumber('一万一')))
t('认不出返回 null', N.chineseToNumber('大概吧') === null)

const f = N.numberForms('那条一万三播放的作品')
t('句子里抠得出一万三的写法', f.includes('13000') || f.includes('11') || f.includes('13'), JSON.stringify(f))
const g = N.numberForms('两万播放')
t('两万给得出 20000', g.includes('20000'), JSON.stringify(g))
const h = N.numberForms('2万播放')
t('阿拉伯加万给得出 20000', h.includes('20000'), JSON.stringify(h))
t('没数字的空数组', N.numberForms('经十路那条马路').length === 0)
t('空串不炸', N.numberForms('').length === 0)

console.log(`数值归一：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
