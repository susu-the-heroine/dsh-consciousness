/**
 * 重试闸自验
 * ==========
 *
 * 同一件事连写两遍，只能有一条；换了内容才能有第二条。
 * 跑法：node scripts/retry-guard-test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'guard-'))
process.env.USERPROFILE = home
process.env.HOME = home

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓ ' + name) } else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

const W = await import('file:///' + join(HERE, '..', 'lib', 'write-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

const input = { title: '重试闸测试', text: '同一句话写两遍，只该留一条。', kind: 'fact' }
const r1 = W.writeOne('main', input)
const r2 = W.writeOne('main', input)
const d1 = S.readSea('main')

ok('第一次写进去了', r1.ok === true && r1.merged !== true, JSON.stringify(r1))
ok('第二次被闸住，返回同一条', r2.ok === true && r2.deduped === true && r2.id === r1.id, JSON.stringify(r2))
ok('库里只有一条', (d1.points || []).length === 1, '条数 ' + (d1.points || []).length)

const r3 = W.writeOne('main', { title: '重试闸测试', text: '换了一句话，该是新的。', kind: 'fact' })
const d2 = S.readSea('main')
ok('换了内容就是新的一条', r3.ok === true && !r3.deduped && (d2.points || []).length === 2, '条数 ' + (d2.points || []).length)

const r4 = W.writeOne('main', input, { retryGuard: false })
ok('显式关掉闸，允许重复（留一个后门）', r4.ok === true && !r4.deduped && (S.readSea('main').points || []).length === 3)

rmSync(home, { recursive: true, force: true })
console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
