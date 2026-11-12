/**
 * 静态守卫
 * ========
 *
 * 不跑逻辑，只读文件，盯几条"改回去就会出事"的约定。
 * 这几条都是真踩过才加上的，不是洁癖。
 *
 * 跑法：node scripts/static-guard-test.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'lib')
const read = (f) => readFileSync(join(LIB, f), 'utf8')

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓ ' + name) } else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

// 1. Python 脚本是否存在的检查，必须在 JS 分支之后
{
  const t = read('tools.js')
  const js = t.indexOf('if (USE_JS_WRITER)')
  const gate = t.indexOf('existsSync(SCRIPT)')
  ok('JS 写入不受"找不到 Python 脚本"影响', js > 0 && gate > js, `js=${js} gate=${gate}`)
}

// 2. 不许往冻结的 args 上挂字段（2026-11-12 因此多写两条）
{
  const t = read('tools.js')
  ok('没有往 args 上挂字段', !/args\.__\w+\s*=/.test(t), '发现 args.__xxx = ...')
}

// 3. 写入成功后的收尾不许抛错：得有 try/catch 包着
{
  const t = read('tools.js')
  const i = t.indexOf('收尾再怎么错')
  const seg = i > 0 ? t.slice(i, i + 900) : ''
  ok('收尾有 try/catch 兜底', seg.includes('try {') && seg.includes('catch (e9)'), '没找到兜底')
}

// 4. 写入库要有重试闸和已持锁版本
{
  const t = read('write-js.js')
  ok('有重试闸', t.includes('重试闸') && t.includes('retryGuard'))
  ok('有"调用方已持锁"的写入', t.includes('export function writeOneLocked'))
}

// 5. 存储层必须是 tmp + rename，不是直接覆盖
{
  const t = read('store-js.js')
  ok('原子写用 tmp + rename', t.includes('renameSync(tmp, real)'), '没找到 rename')
  ok('写前有备份', t.includes('backupSea('))
}

console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
