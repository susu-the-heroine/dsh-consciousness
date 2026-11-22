/**
 * 压缩感知 + 规矩在场断言测试（2026-11-16，清单第 12 件）
 * 纯内存，不碰主库。验证：
 *   1) 数得出【规矩·不许忘】下面的条数
 *   2) 条数持平 → ok
 *   3) 条数缩水 → 抓出来
 *   4) 整块没了 → 抓出来
 *   5) 从没立过规矩（两边都是 0）不算坏
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let fails = 0
function ok (name, cond) {
  if (cond) console.log('过 ', name)
  else { fails++; console.log('栽 ', name) }
}

const c = await import(pathToFileURL(join(ROOT, 'lib', 'compaction.js')).href + '?v=' + Date.now())

const full = '【识海 · 记忆上下文】\n【规矩·不许忘】\n· 甲\n· 乙\n· 丙\n别的'

ok('数得清条数', c.countRules(full) === 3)
ok('没有规矩栏是 0', c.countRules('没有这回事') === 0)

{
  c.noteRules(full)
  ok('持平就 ok', c.assertRules(full, 't').ok === true)
  const shrunk = '【规矩·不许忘】\n· 甲'
  const r = c.assertRules(shrunk, 't')
  ok('缩水抓得出来', r.ok === false && r.why === 'shrunk' && r.was === 3 && r.now === 1)
  const gone = c.assertRules('全没了', 't')
  ok('整块没了抓得出来', gone.ok === false && gone.why === 'missing')
}

{
  // 新库：上次 0、这次 0 —— 不算坏。得开一个干净实例测，前面的用例已经立过底线。
  const c2 = await import(pathToFileURL(join(ROOT, 'lib', 'compaction.js')).href + '?fresh=' + Date.now())
  const r = c2.assertRules('没立过规矩', 't')
  ok('从没立过规矩不算坏', r.ok === true)
}

console.log(fails ? '压缩感知：栽 ' + fails : '压缩感知：全过')
process.exit(fails ? 1 : 0)
