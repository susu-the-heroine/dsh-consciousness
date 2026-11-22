/**
 * 词门保底 · 正反自测
 *
 * 正：库里只有一条、说法对不上但确有词面重合（光年 / 光走一年），要答，别交白卷。
 * 反：同一个小库里，编的问题照样要拒——保底不是把关口拆了。
 *
 * 2026-11-19 实测：这一条把别人家的库从七成提到八成五，自己的库一分没动。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'keep-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const sea = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(sea, { recursive: true })
writeFileSync(join(sea, 'data.json'), JSON.stringify({
  version: 1,
  points: [{
    id: 11,
    title: '光走一年',
    text: '一光年是光在真空中走一年的距离，约九点四六万亿公里。',
    kind: 'fact',
    born: Date.now() - 86400000,
    strength: 40,
    layer: 'experience',
    imp: 0.6,
    arousal: 4,
  }],
  edges: [],
}), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const ask = async (q) => String((await searchTool.execute({ query: q, limit: 3, review: false })).log || '')

const a = await ask('一光年有多长')
t('说法不同但有词面重合，要答', a.includes('#11') || a.includes('光走一年'), a.slice(0, 40))

const b = await ask('南极企鹅的饲养许可证怎么办')
t('编的问题照样拒', /没记过|没这个|找不到/.test(b.slice(0, 30)), b.slice(0, 30))

const c = await ask('潜艇驾照怎么考')
t('第二句编的也拒', /没记过|没这个|找不到/.test(c.slice(0, 30)), c.slice(0, 30))

const d = await ask('一光年的距离')
t('换个问法也答得出', d.includes('光走一年') || d.includes('#11'), d.slice(0, 40))

console.log(`词门保底：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
