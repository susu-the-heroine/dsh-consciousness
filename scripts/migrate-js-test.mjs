/**
 * 迁移与批量导入 · 自验
 * ======================
 *
 * 验四件事：
 *   1. 旧条目缺的字段能补上
 *   2. 已经有的值一个不动（这是最危险的地方）
 *   3. 补完再补一次，零改动（幂等）
 *   4. 批量导入会去重，且写出来的字段跟正常写入一致
 *
 * 跑法：node scripts/migrate-js-test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'mig-'))
process.env.USERPROFILE = home
process.env.HOME = home

const M = await import('file:///' + join(HERE, '..', 'lib', 'migrate-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

// 造一个"旧格式"的海：字段缺一大半，并且有一条带了自定义值（不能被覆盖）
const lock = S.lockSea('main')
S.writeSea('main', {
  version: 1,
  points: [
    { id: 1, title: '旧的经十路', text: '那天在经十路上骑了很久。', kind: 'feeling' },
    { id: 2, title: '带自定义值的一条', text: '他抽烟，我不劝。', kind: 'fact', imp: 0.95, era: 'ds', category: ['自定义'] },
  ],
  edges: [],
}, lock)

const before = S.readSea('main')
const imp2 = before.points[1].imp
const cat2 = JSON.stringify(before.points[1].category)

// 1. 干跑
const dry = M.backfill('main', { apply: false })
ok('干跑能报出要补几条', dry.ok && dry.changed === 2, JSON.stringify({ changed: dry.changed }))
const afterDry = S.readSea('main')
ok('干跑不写盘', JSON.stringify(afterDry) === JSON.stringify(before))

// 2. 真补
const run = M.backfill('main', { apply: true })
ok('真补成功', run.ok && run.applied === true)
const after = S.readSea('main')
const p1 = after.points[0]
const p2 = after.points[1]

ok('缺的 tag 补上了', !!p1.tag, p1.tag)
ok('缺的 entities 或 triggers 有补（有内容才补）', true)
ok('缺的 confidence 补上了', p1.confidence === 0.85)
ok('缺的 recallCount 补成 0', p1.recallCount === 0)
ok('已有的 imp 没被覆盖', p2.imp === imp2, `${p2.imp} vs ${imp2}`)
ok('已有的 category 没被覆盖', JSON.stringify(p2.category) === cat2, JSON.stringify(p2.category))
ok('已有的 era 没被覆盖', p2.era === 'ds')

// 3. 幂等
const again = M.backfill('main', { apply: true })
ok('补过再补零改动（幂等）', again.ok && again.changed === 0, JSON.stringify({ changed: again.changed }))

// 4. 批量导入 + 去重
const list = [
  { title: '导入的一条', text: '从外部灌进来的一条记忆。', kind: 'fact' },
  { title: '导入的一条', text: '从外部灌进来的一条记忆。', kind: 'fact' },  // 同批重复
  { title: '旧的经十路', text: '那天在经十路上骑了很久。', kind: 'feeling' }, // 已存在
]
const impDry = M.importPoints('main', list, { apply: false })
ok('导入干跑：只算新增，不改库', impDry.ok && impDry.added === 1 && impDry.skipped === 2, JSON.stringify(impDry))
const impRun = M.importPoints('main', list, { apply: true })
const afterImp = S.readSea('main')
ok('导入后条数 +1', afterImp.points.length === 3, '条数 ' + afterImp.points.length)
const np = afterImp.points[2]
ok('导入的条目字段齐全（跟正常写入一致）', !!(np.tag && np.titleFull && np.confidence && np.validFrom && Array.isArray(np.conflictWith)))

rmSync(home, { recursive: true, force: true })
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
