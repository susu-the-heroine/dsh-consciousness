import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 数条数不许起子进程
 * ==================
 *
 *   node scripts/test-count.mjs
 *
 * 用户反馈（0.4.9，Windows 桌面版）：点「数条数」直接报错。
 * 两个原因叠在一起——包里没有 scripts/，且 _nodeBin 指向的是
 * DeepSeek Harness.exe 而不是 node。现在改成自己读盘，当场数。
 *
 * 这条测的就是：不 spawn 也能出数，且数字对。
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-count-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { countTool } = await import(LIB + '/tools.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

writeSea('main', {
  version: 3,
  points: [
    { id: 1, title: '甲', text: '甲的事' },
    { id: 2, title: '乙', text: '乙的事' },
    { id: 3, title: '丙', text: '丙的事', dead: true },
  ],
  edges: [{ from: 1, to: 2 }],
})

const r = await countTool.execute()
ok('数得动，不报错', r && r.ok === true, JSON.stringify(r).slice(0, 120))
ok('条数对：活两条', /记忆 2 条/.test(r.log), r.log)
ok('连对数：一根', /连线 1 根/.test(r.log), r.log)
ok('认得出一个海', /识海 1 个/.test(r.log), r.log)
ok('不吐 execPath 那类错误', !/Command failed|\.exe/i.test(r.log), r.log)

console.log(`\n数条数自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
