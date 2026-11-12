/**
 * 热参数测试：改数字不用重启
 * ========================
 * 跑法：node test/live.test.mjs
 */
import { existsSync, rmSync } from 'node:fs'

const BASE = new URL('../', import.meta.url).href
const L = await import(BASE + 'lib/live.js')
const C = await import(BASE + 'lib/cap.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const F = L.livePath()
if (existsSync(F)) rmSync(F)

console.log('\n热参数：')

// 一、默认值
const d = L.readLive()
ok(d.capMax === 2200, '默认上限 2200', d.capMax)
ok(d.damp === 0.45, '默认阻尼 0.45', d.damp)

// 二、写进去读得回
L.writeLive({ capMax: 900 })
ok(L.readLive().capMax === 900, '写进去立刻读得回', L.readLive().capMax)

// 三、范围夹紧
L.writeLive({ capMax: 1 })
ok(L.readLive().capMax === 400, '太小的上限被夹到 400', L.readLive().capMax)
L.writeLive({ capMax: 999999 })
ok(L.readLive().capMax === 8000, '太大的上限被夹到 8000', L.readLive().capMax)
L.writeLive({ damp: 3 })
ok(L.readLive().damp === 1, '超范围的阻尼夹到 1', L.readLive().damp)

// 四、坏值不炸、不覆盖
const before = L.readLive().capMax
L.writeLive({ capMax: 'abc' })
ok(L.readLive().capMax === before, '坏值不覆盖原值', L.readLive().capMax)
const r = L.writeLive(null)
ok(r.ok, '传 null 不炸')

// 五、**核心**：同一个进程里改上限，截断行为立刻跟着变（不用重启）
L.writeLive({ capMax: 2200 })
const parts = ['【识海 · 记忆上下文】', '甲'.repeat(1150)]
const a = C.capParts(parts)
ok(a.truncated === false, '2200 时不截', a.parts.join('').length)
L.writeLive({ capMax: 800 })
const b = C.capParts(parts)
ok(b.truncated === true, '改到 800 后立刻截（没重启）', b.parts.join('').length)
L.writeLive({ capMax: 2200 })
const c = C.capParts(parts)
ok(c.truncated === false, '改回去又立刻不截')

// 六、sane 对各键都管用
for (const k of Object.keys(L.DEFAULTS)) {
  ok(Number.isFinite(L.sane(k, -999)), 'sane(' + k + ') 给得出数')
}

if (existsSync(F)) rmSync(F)

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
