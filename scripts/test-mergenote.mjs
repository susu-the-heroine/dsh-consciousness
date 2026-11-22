/**
 * 并错了要喊一声
 * ==============
 *
 *   node scripts/test-mergenote.mjs
 *
 * 正面：两条几乎一样 → 不出声；说得不一样 → 提醒看一眼；差太远 → 提醒可能并错
 * 反面：空值不炸、不出脏字、不把「并」说成「新建」
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/mergenote.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { roughSim, mergeNote } = await import(L + '/mergenote.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const same = mergeNote('显卡那晚', '显卡那晚跑通了，星星出来了。', '显卡那晚', '显卡那晚跑通了，星星出来了。')
ok('一模一样不出声', same === '', JSON.stringify(same))

const near = mergeNote('显卡那晚', '显卡那晚跑通了，星星出来了。', '显卡那晚', '显卡那晚跑通了，星星出来了，但还得改。')
ok('说得不一样就提醒', /说法不太一样/.test(near), JSON.stringify(near))

const far = mergeNote('显卡那晚', '显卡画神经跑通了。', '阑尾炎', '打了八天吊针，洋葱圈划舌头。')
ok('差太远说可能并错', /差得有点远/.test(far), JSON.stringify(far))

ok('相似度满值', roughSim('abc', 'abc') === 1)
ok('完全不像接近零', roughSim('显卡', '阑尾炎') < 0.2)
ok('空值不炸', roughSim('', null) === 0 && mergeNote(null, null, null, null) === '')
ok('不把并说成新建', !/新建|写入/.test(near + far))
ok('不带脏字不骂人', !/废物|垃圾|蠢/.test(near + far))

console.log(`\n并错喊一声自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
