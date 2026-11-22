/**
 * 结果多样性 · 正反自测
 *
 * 正：同主题第四条往后放，不同主题照留。
 * 反：主题都不一样时一条都不许压；不够数时要把压下去的补回来。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/diversity.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'div-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const D = await import(LIB + '/diversity.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}
const mk = (id, title) => ({ p: { id, title } })

t('同题认得出（重叠高）', D.sameTopic('经十路那条马路', '经十路那条马路啊'))
t('不同题不硬认', !D.sameTopic('经十路那条马路', '阑尾炎八天吊针'))

const same = [mk(1, '经十路那条马路'), mk(2, '经十路那条马路啊'), mk(3, '经十路那条马路，长'), mk(4, '经十路那条马路哈'), mk(5, '别的完全不一样的事')]
const out = D.pickDiverse(same, 5, 3)
const keptSame = out.filter((x) => /经十路/.test(x.p.title)).length
t('同题最多三条', keptSame === 3, String(keptSame))
t('不同题照留', out.some((x) => x.p.id === 5))
t('条数不超限', out.length <= 5, String(out.length))

const distinct = [mk(1, '经十路'), mk(2, '阑尾炎'), mk(3, '薯片渣'), mk(4, '副业'), mk(5, '打赌')]
const out2 = D.pickDiverse(distinct, 5, 3)
t('全不同时一条不压', out2.length === 5, String(out2.length))

const few = [mk(1, '经十路'), mk(2, '阑尾炎')]
t('不够数不硬凑', D.pickDiverse(few, 5, 3).length === 2)
t('空列表不炸', D.pickDiverse([], 5, 3).length === 0)

// 压下去的补回来：三条同题 + 一条别的，要 4 条
const mix = [mk(1, '经十路那条马路'), mk(2, '经十路那条马路啊'), mk(3, '经十路那条马路，长'), mk(4, '经十路那条马路哈'), mk(5, '别的')]
const out3 = D.pickDiverse(mix, 4, 3)
t('补回来不超总限', out3.length === 4, String(out3.length))

console.log(`结果多样性：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
