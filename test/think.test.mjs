/**
 * 第三层（想一句）的测试
 * =====================
 * 注意：这里测的是"闸门、拼 prompt、落库、记账"，**不测模型本身**——
 * 插件里没有模型 API，最后那一次调用由宿主完成。
 *
 * 跑法：node test/think.test.mjs
 */
// 测试用临时文件，不在真数据上跑
import { tmpdir } from 'node:os'
process.env.DSH_SELFMIND_FILE = String(tmpdir()) + '/dsh-self-test-' + process.pid + '.json'
process.env.DSH_SELFMODE_FILE = String(tmpdir()) + '/dsh-mode-test-' + process.pid + '.json'

import { existsSync, rmSync, copyFileSync } from 'node:fs'

const BASE = new URL('../', import.meta.url).href
const T = await import(BASE + 'lib/think.js')
const M = await import(BASE + 'lib/selfmode.js')
const S = await import(BASE + 'lib/selfmind.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

// 先记住真实档位，测完必须还原（教训：之前测试把档位留在 low，他点开的 max 被清了）
const __levelBefore = M.readMode().level

// 清干净
// 不删真文件：先备份，测完还原
for (const f of [S.selfPath(), M.modePath()]) {
  if (existsSync(f) && !existsSync(f + '.testbak')) copyFileSync(f, f + '.testbak')
}
// 当日计数清零（有备份，跑完还原）
try { const m = M.readMode(); m.thoughtsToday = 0; M.writeMode(m) } catch {}

console.log('\n第三层：')

// 关着的时候不许想
M.setLevel('low')
let p1 = T.planThink()
ok(!p1.ok, 'low 档不许想', p1.reason)

M.setLevel('high')
let p2 = T.planThink()
ok(!p2.ok, 'high 档也不许想（不花钱）', p2.reason)

M.setLevel('max')
let p3 = T.planThink()
ok(p3.ok, 'max 档可以想', p3.reason)
ok(typeof p3.prompt === 'string' && p3.prompt.length > 40, 'prompt 拼出来了', String(p3.prompt && p3.prompt.length))

// prompt 里的规矩必须写死
const pr = p3.prompt || ''
ok(pr.includes('60'), 'prompt 里写了字数上限')
ok(pr.includes('不许'), 'prompt 里写了禁止项')
ok(pr.includes('第一人称'), 'prompt 里要求第一人称')
ok(pr.includes('不许提') && pr.includes('讨债'), 'prompt 里写死了「不讨债」')

// 想出来的东西要落进私有池
const before = S.listThoughts(50, true).length
const r1 = T.finishThink('「今天有点沉，说不上来为什么。」', 800)
ok(r1.ok, '写成了一条念头', r1.reason)
ok(S.listThoughts(50, true).length === before + 1, '池子里多了一条')

// 太长要截
const r2 = T.finishThink('啊'.repeat(200), 800)
ok(r2.ok && [...r2.thought.text].length <= T.MAX_THOUGHT_CHARS, '太长截到上限', String(r2.thought && r2.thought.text.length))

// 空的不算，记一次失败
const r3 = T.finishThink('   ', 100)
ok(!r3.ok, '空的不算')

// 额度：max 一天三条
const r4 = T.finishThink('第三条。', 800)
ok(r4.ok, '第三条还能写')
const gate = T.planThink()
ok(!gate.ok && String(gate.reason).includes('够'), '第四条被闸门挡住', gate.reason)

// 熔断：连败三次 → 退回 high
M.setLevel('max')
for (let i = 0; i < 3; i++) T.finishThink('', 0)
ok(M.readMode().level === 'high', '连败三次自动退回 high', M.readMode().level)
ok(String(M.readMode().trippedReason).length > 0, '熔断原因记下来了')

// 复位：清掉测试写的东西，再把档位还给原来的值
for (const f of [S.selfPath(), M.modePath()]) {
  if (existsSync(f + '.testbak')) { copyFileSync(f + '.testbak', f); rmSync(f + '.testbak') }
}
try { M.setLevel(__levelBefore) } catch {}

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
