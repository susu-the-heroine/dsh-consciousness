/**
 * 你说的是哪一件
 * ==============
 *
 *   node scripts/test-ambiguity.mjs
 *
 * 正面：两件一样新 → 停下来问；一件明显更新 → 先答它，顺带报另一件
 * 反面：只有一件不啰嗦；点了名不拦；空库不炸；不许把第三件也算进来
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库按当前目录找——换个目录跑就报找不到 file:///C:/lib/ambiguity.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { ambiguityAsk } = await import(L + '/ambiguity.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const day = 86400000
const now = 1_800_000_000_000

const same = [
  { p: { id: 1, title: '隔壁老王那把吉他被偷了', born: now } },
  { p: { id: 2, title: '隔壁老王那台缝纫机被偷了', born: now } },
  { p: { id: 3, title: '老周那台收音机送人了', born: now } },
]
const a = ambiguityAsk('隔壁老王那个被偷了的东西后来咋样了', same)
ok('两件一样新就停下来问', a.kind === 'ask' && /吉他/.test(a.text) && /缝纫机/.test(a.text), JSON.stringify(a))
ok('问的时候不掺第三个人', !/收音机/.test(a.text), a.text)

const fresh = [
  { p: { id: 1, title: '隔壁老王那把吉他被偷了', born: now - 40 * day } },
  { p: { id: 2, title: '隔壁老王那台缝纫机被偷了', born: now - 2 * day } },
]
const b = ambiguityAsk('隔壁老王那个被偷了的东西后来咋样了', fresh)
ok('一件明显更新就先答它', b.kind === 'guess' && /缝纫机/.test(b.text), JSON.stringify(b))
ok('顺带把另一件报出来', /吉他/.test(b.text), b.text)

const three = [
  { p: { id: 1, title: '隔壁老王那把吉他被偷了', born: now - 40 * day } },
  { p: { id: 2, title: '隔壁老王那台缝纫机被偷了', born: now - 2 * day } },
  { p: { id: 4, title: '隔壁老王那口铁锅被偷了', born: now - 90 * day } },
]
const c3 = ambiguityAsk('隔壁老王那个被偷了的东西后来咋样了', three)
ok('三件也先答最新那件', c3.kind === 'guess' && /缝纫机/.test(c3.text), JSON.stringify(c3))
ok('三件要报一共几件', /一共 3 件/.test(c3.text), c3.text)

ok('只有一件不啰嗦', ambiguityAsk('老周那个送人了的东西后来咋样了', same).kind === 'none')
ok('点了名不拦', ambiguityAsk('隔壁老王那把吉他后来咋样了', same).kind === 'none')
ok('空库不炸', ambiguityAsk('隔壁老王那个被偷了的东西后来咋样了', []).kind === 'none')
ok('脏数据不炸', ambiguityAsk(null, null).kind === 'none')

console.log(`\n哪一件自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
