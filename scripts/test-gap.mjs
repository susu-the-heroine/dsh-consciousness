/**
 * 显式的缺口
 * ==========
 *
 *   node scripts/test-gap.mjs
 *
 * 正面：问句指名「那台老式打字机」、候选里一次都没这词 → 直说没记过
 * 反面：候选里有这件就不许拒；问句没指名物件不许拒；空候选不许乱拒；脏数据不炸
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/gap.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { askedObjects, gapRefusal } = await import(L + '/gap.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const txt = (x) => String((x && x.p && x.p.title) || '') + String((x && x.p && x.p.text) || '')
const sea = [
  { p: { title: '老周那台旧相机被偷了', text: '老周那台旧相机被偷了，一直没找回来。' } },
  { p: { title: '阿亮那辆电动车送人了', text: '阿亮把电动车送给了他弟。' } },
]

ok('挑得出物件词', askedObjects('老周那台老式打字机后来咋样了').includes('老式打字机'),
  JSON.stringify(askedObjects('老周那台老式打字机后来咋样了')))

ok('库里没这物件就直说没记过', /没记过/.test(gapRefusal('老周那台老式打字机后来咋样了', sea, txt)))

ok('库里有就不许拒', gapRefusal('老周那台旧相机后来咋样了', sea, txt) === '')
ok('没指名物件就不拒', gapRefusal('老周后来咋样了', sea, txt) === '')
ok('空候选不乱拒', gapRefusal('老周那台老式打字机后来咋样了', [], txt) === '')
ok('脏数据不炸', gapRefusal(null, null, null) === '' && Array.isArray(askedObjects(null)))
ok('拒的时候不编细节', !/很可能|估计|应该是/.test(gapRefusal('老周那台老式打字机后来咋样了', sea, txt)))

console.log(`\n显式缺口自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
