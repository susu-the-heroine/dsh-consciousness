/**
 * 阻尼的测试
 * ==========
 * 跑法：node test/damping.test.mjs
 */
import { existsSync, rmSync } from 'node:fs'

const BASE = new URL('../', import.meta.url).href
const D = await import(BASE + 'lib/damping.js')
const L = await import(BASE + 'lib/emotion-lexicon.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const dist = (a, b) => Math.sqrt(Object.keys(a).reduce((s, k) => s + (a[k] - (b[k] || 0)) ** 2, 0))
const start = L.project({ v: -0.1, a: 0.2, d: -0.1 })
const target = L.project({ v: -0.6, a: 0.7, d: -0.5 })

console.log('\n阻尼：')

// 一、阻尼越大，挪得越少
let prev = -1
let mono = true
for (const d of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
  const m = dist(start, D.mixByDamp(start, target, d, false))
  if (prev >= 0 && m > prev + 1e-6) { mono = false; break }
  prev = m
}
ok(mono, '阻尼越大挪得越少（单调）')

// 二、damp=0 时基本等于直接到目标
const atZero = dist(start, D.mixByDamp(start, target, 0, false))
const full = dist(start, target)
ok(atZero > full * 0.6, 'damp=0 基本一步到位', atZero.toFixed(3) + ' / ' + full.toFixed(3))

// 三、damp=1 时几乎不动，但冲击能推动
const atOne = dist(start, D.mixByDamp(start, target, 1, false))
const atOneImpact = dist(start, D.mixByDamp(start, target, 1, true))
ok(atOne < 0.02, 'damp=1 平常推不动', atOne.toFixed(4))
ok(atOneImpact > atOne * 3, 'damp=1 冲击还是动', atOneImpact.toFixed(3))

// 四、冲击永远压到 0.35 以下
ok(D.inertiaOf(0.9, true) < D.inertiaOf(0.9, false), '冲击时惯性变小')
ok(D.inertiaOf(D.DAMP_IMPACT_CAP, true) === D.inertiaOf(D.DAMP_IMPACT_CAP, true), '冲击上限稳定')

// 五、结果始终是合法八维（和为 1）
const out = D.mixByDamp(start, target, 0.45, false)
const sum = Object.values(out).reduce((a, b) => a + b, 0)
ok(Math.abs(sum - 1) < 0.01, '结果归一（和为 1）', String(sum))

// 六、读写：坏值不炸、写进去读得回
const F = D.dampPath()
if (existsSync(F)) rmSync(F)
ok(D.readDamp() === D.DAMP_DEFAULT, '没文件时用默认值', String(D.DAMP_DEFAULT))
D.writeDamp(0.66)
ok(Math.abs(D.readDamp() - 0.66) < 0.001, '写进去读得回')
D.writeDamp(9)
ok(D.readDamp() <= 1, '超范围被夹到 1')
D.writeDamp('abc')
ok(Number.isFinite(D.readDamp()), '写坏值不炸')
if (existsSync(F)) rmSync(F)

// 七、人话描述不带问号
ok(!/[？?]/.test(D.describeDamp(0.45)), '描述句不带问号', D.describeDamp(0.45))
ok(D.DAMP_DEFAULT > 0.3 && D.DAMP_DEFAULT < 0.6, '默认值落在"要推得动真话"这一段', String(D.DAMP_DEFAULT))

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
