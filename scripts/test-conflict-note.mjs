/**
 * 记得自己改过口：打架要说出来，但不替人拿主意
 * =====================================
 *
 *   node scripts/test-conflict-note.mjs
 *
 * 正面：有冲突就提一句「说法对不上，我没替你定」
 * 反面：没冲突不许贴这句；空数组、脏数据都不许炸；不许带编号、不许替人下结论
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const { conflictNote } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const hit = conflictNote({ conflictWith: [12] })
const hit2 = conflictNote({ conflictWith: [12, 30] })
const none = conflictNote({ conflictWith: [] })
const missing = conflictNote({})
const junk = conflictNote({ conflictWith: [null, undefined, '', 0] })
const broken = conflictNote({ conflictWith: 'oops' })

check('有冲突就提一句', /说法对不上/.test(hit), hit)
check('多条冲突也只提一句', (hit2.match(/说法对不上/g) || []).length === 1, hit2)
check('没冲突不许提', none === '', JSON.stringify(none))
check('没这字段也不许提', missing === '', JSON.stringify(missing))
check('脏数据不炸也不提', junk === '', JSON.stringify(junk))
check('字段类型错也不炸', broken === '', JSON.stringify(broken))
check('不替人拿主意', !/我信|我认为|新的是对的|以新的为准/.test(hit), hit)
check('不带编号', !/#\d/.test(hit), hit)

console.log(`\n改口提示自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
