/**
 * 拒答口径 · 正反自测
 *
 * 正：三类说法各就各位，都只跟一句下一步。
 * 反：不许追问、不许四种口气、不许把「没记过」说成「忘了」。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库按当前目录找——换个目录跑就报找不到 file:///C:/lib/refusal.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const R = await import(LIB + '/refusal.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const a = R.notRecorded('那次打赌')
const b = R.weakScore('他说的那句话')
const c = R.windowEmpty('去年冬天')

t('没记过带原问句', a.includes('那次打赌'), a)
t('没记过不许说成忘了', !a.includes('忘了'), a)
t('低分说「没记住」', b.includes('没记住'), b)
t('时间窗说「什么都没记」', c.includes('什么都没记'), c)
t('每句只有一句下一步', [a, b, c].every((s) => (s.match(/。\n（/g) || []).length <= 1), a)
t('都不带问号', [a, b, c].every((s) => !s.includes('？')), a + b + c)
t('空问句不炸', typeof R.notRecorded('') === 'string')
t('三类的开头不重样', new Set([a.slice(0, 6), b.slice(0, 6), c.slice(0, 6)]).size === 3)

console.log(`拒答口径：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
