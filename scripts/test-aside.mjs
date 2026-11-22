/**
 * 顺带想起：问一件，带出另一件
 * ==========================
 *
 *   node scripts/test-aside.mjs
 *
 * 正面：头一条有边、边上那件不在结果里 → 提一句，带标题和大概时间
 * 反面：没边不提；边上那件已经在结果里不提；归档的不提；脏数据不炸；只提一件
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const { asideFor } = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

const now = Date.now()
const day = 86400000
const data = {
  points: [
    { id: 1, title: '显卡那晚', born: now - 2 * day },
    { id: 2, title: '重画识海', born: now - 2 * day },
    { id: 3, title: '归档那件', born: now - 2 * day, archived: true },
    { id: 4, title: '另一个邻居', born: now - 10 * day },
  ],
  edges: [{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 1, to: 4 }],
}

const hit = asideFor(1, data, [1])
check('有边就提一句', /顺带想起/.test(hit) && /重画识海/.test(hit), hit)
check('带大概时间', /前两天|上周/.test(hit), hit)
check('只提一件', (hit.match(/顺带想起/g) || []).length === 1, hit)

const shown = asideFor(1, data, [1, 2, 4])
check('边上的都在结果里就不提', shown === '', JSON.stringify(shown))

const onlyArchived = asideFor(1, { points: [data.points[0], data.points[2]], edges: [{ from: 1, to: 3 }] }, [1])
check('归档的邻居不提', onlyArchived === '', JSON.stringify(onlyArchived))

check('没边不提', asideFor(1, { points: data.points, edges: [] }, [1]) === '')
check('没这号也不提', asideFor(99, data, [99]) === '')
check('脏数据不炸', asideFor(1, { points: null, edges: 'x' }, [1]) === '')

console.log(`\n顺带想起自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
