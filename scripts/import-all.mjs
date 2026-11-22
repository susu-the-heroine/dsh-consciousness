/**
 * 每个模块都能导入吗
 * ================
 *
 *   node scripts/import-all.mjs
 *
 * 为什么需要：语法检查抓不到"导入时就炸"的错——少一个 import、顶层调用了一个
 * 没定义的函数、循环依赖里拿到 undefined，都要真的 import 一遍才知道。
 * 2026-11-14 夜：seas.js 少了三个 import，语法过、一导入就 ReferenceError，
 * 结果窗口标题一直是空、示例识海装不进去。这条就是那天补的。
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'lib')

const files = readdirSync(LIB).filter((f) => f.endsWith('.js')).sort()
const bad = []
for (const f of files) {
  try {
    await import(pathToFileURL(join(LIB, f)).href)
  } catch (e) {
    bad.push(f + ' :: ' + String((e && e.message) || e).slice(0, 100))
  }
}

// 2026-11-21：原来只导入库目录——入口那个文件和命令行那份都不在范围里。
// 可那次「少三个 import、一导入就炸」摔的就是入口，而入口恰恰没被这一关扫过。
// 加上它们：导入成功即说明顶层没炸（不调用导出函数，没有副作用）。
const extra = ['index.js', join('bin', 'sea-api.mjs')]
for (const rel of extra) {
  try {
    await import(pathToFileURL(join(HERE, '..', rel)).href)
  } catch (e) {
    bad.push(rel + ' :: ' + String((e && e.message) || e).slice(0, 100))
  }
}

console.log(`模块 ${files.length + extra.length} 个 · 导入失败 ${bad.length}`)
for (const b of bad) console.log('  ' + b)
process.exit(bad.length === 0 ? 0 : 1)
