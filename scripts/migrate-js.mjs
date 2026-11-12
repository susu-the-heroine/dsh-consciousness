/**
 * 迁移与批量导入 · 命令行
 * ========================
 *
 * 给真实使用准备的入口（原来这些活只有 Python 脚本能干）。
 *
 *   node scripts/migrate-js.mjs --sea main --scan
 *   node scripts/migrate-js.mjs --sea main --backfill            # 干跑，只报告
 *   node scripts/migrate-js.mjs --sea main --backfill --apply    # 真写
 *   node scripts/migrate-js.mjs --sea main --import 某文件.json [--apply]
 *
 * 规矩：只填空，不覆盖；不加 --apply 一律不写盘。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const M = await import('file:///' + join(HERE, '..', 'lib', 'migrate-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

const args = process.argv.slice(2)
const get = (k, d = null) => {
  const i = args.indexOf(k)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const sea = get('--sea', 'main')
const apply = args.includes('--apply')

if (args.includes('--scan')) {
  const r = M.scan(sea)
  console.log(r.ok ? `共 ${r.total} 条 · 缺字段的 ${r.dirty} 条\n缺什么：${JSON.stringify(r.stat)}` : r.err)
} else if (args.includes('--backfill')) {
  const r = M.backfill(sea, { apply })
  if (!r.ok) { console.log('失败：', r.err); process.exit(1) }
  console.log(`共 ${r.total} 条 · 要补 ${r.changed} 条${apply ? '（已写）' : '（干跑，没写）'}`)
  console.log('补什么：', JSON.stringify(r.stat))
} else if (get('--import')) {
  const f = get('--import')
  const list = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  const arr = Array.isArray(list) ? list : (list.points || [])
  const r = M.importPoints(sea, arr, { dedupe: true, apply })
  if (!r.ok) { console.log('失败：', r.err); process.exit(1) }
  console.log(`要导入 ${r.added} 条 · 跳过重复 ${r.skipped} 条${apply ? '（已写）' : '（干跑，没写）'}`)
} else {
  console.log('用法：--scan | --backfill [--apply] | --import 文件.json [--apply]，都要配 --sea')
}
