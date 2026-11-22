/**
 * 物件名册
 * ========
 *
 *   node scripts/test-objects.mjs
 *
 * 正面：从「他哥那把菜刀忘在车上」切出「菜刀」；少打一个字（收机/收音机）能补
 * 反面：铜锅不补成铁锅；不把「后来」「咋样」当物件；空值不炸；名册不收正文以外的鬼话
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/objects.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { cutObject, objectsIn, buildLexicon, repairQuery, nearOne } = await import(L + '/objects.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

ok('切出两个字的名字', cutObject('菜刀忘在车上') === '菜刀', cutObject('菜刀忘在车上'))
ok('一个字也往后再借', cutObject('斗鱼换了新的') === '斗鱼', cutObject('斗鱼换了新的'))
ok('三个字的名字不断', cutObject('收音机送人了') === '收音机', cutObject('收音机送人了'))
ok('抽得出物件', objectsIn('他哥那把菜刀忘在车上，老周那台收音机送人了').sort().join(',') === '收音机,菜刀',
  JSON.stringify(objectsIn('他哥那把菜刀忘在车上，老周那台收音机送人了')))

const pts = [
  { title: '他哥那把菜刀忘在车上', text: '他哥那把菜刀忘在车上，后来找到了。' },
  { title: '他哥那把铁锅没动', text: '他哥那把铁锅一直没动。' },
  { title: '老周那台收音机送人了', text: '老周那台收音机送人了。' },
]
const lex = buildLexicon(pts)
ok('名册收标题里的名字', lex.has('菜刀') && lex.has('收音机'), [...lex.keys()].join(','))
ok('名册也收正文里的名字', lex.has('铁锅'), [...lex.keys()].join(','))

const r1 = repairQuery('老周那台收机送人了', lex)
ok('少打一个字能补上', r1.query.includes('收音机') && r1.note.includes('收音机'), JSON.stringify(r1))

const r2 = repairQuery('他哥那口铜锅后来咋样了', lex)
ok('换一个字不许乱补', !r2.query.includes('铁锅'), JSON.stringify(r2))

ok('差一个字认得出', nearOne('收机', '收音机') === true)
ok('差两个字认不出', nearOne('铜锅', '收音机') === false)
ok('空值不炸', cutObject(null) === '' && objectsIn(null).length === 0 && buildLexicon(null).size === 0)
ok('别把问法当物件', objectsIn('那个东西后来咋样了').length === 0, JSON.stringify(objectsIn('那个东西后来咋样了')))

console.log(`\n物件名册自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
