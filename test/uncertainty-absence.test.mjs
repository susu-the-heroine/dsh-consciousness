/**
 * 不确定性 + 挂念疏远 的测试
 * =========================
 *
 * 这两块都是纯函数，也是最容易被"感觉对"骗过去的地方。
 * 规矩钉死：编的必须标、挂念先涨后落、疏远封顶、恢复不对称。
 *
 * 跑法：node test/uncertainty-absence.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const U = await import(BASE + 'lib/uncertainty.js')
const A = await import(BASE + 'lib/absence.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n不确定性：')

// 编造出来的日期必须被认成"猜的"
const fabricated = { id: 1, title: '他住在济南经十路', born: Date.now() - 86400000 * 4, bornEstimated: true, confidence: 0.85 }
ok(U.sourceOf(fabricated) === 'guess', '标了 bornEstimated 的 → 判定为「我估的」')
ok(U.timeConfidenceOf(fabricated) < 0.5, '编的日期：时间置信度低于 0.5', String(U.timeConfidenceOf(fabricated)))
ok(U.shouldMark(fabricated), '编的日期必须在注入里标出来')
ok(U.markText(fabricated).includes('估'), '标注文案说的是「估」', U.markText(fabricated))

// 有原话指针的，是高置信
const fromHim = { id: 2, title: '原话', evidenceRef: { file: '2026-11-07.jsonl', line: 3 } }
ok(U.sourceOf(fromHim) === 'he', '有原话指针 → 他说的')
ok(U.confidenceOf(fromHim) >= 0.9, '他说的置信度 ≥ 0.9')
ok(!U.shouldMark(fromHim), '他说的不标')

// 我自己写的感受
const mine = { id: 3, kind: 'feeling' }
ok(U.sourceOf(mine) === 'her', '感受类 → 我自己写的')
ok(!U.shouldMark(mine), '自己写的不到标注线（0.7 > 0.5）')

// 确认 / 起疑
const p = { id: 4, bornEstimated: true, confidence: 0.3 }
U.confirm(p, 1000)
ok(p.confidence === 0.95 && p.verifiedAt === 1000, 'confirm 把置信度拉到 0.95 并记时间')
U.doubt(p, 2000)
ok(p.confidence === 0.25 && p.source === 'guess', 'doubt 打到 0.25 并记为猜')

// 只降权不筛掉
const w = U.rankWeight({ id: 5, confidence: 0.2 })
ok(w > 0.8 && w < 1, '低置信度只降权约 15%，不归零', String(w))

console.log('\n挂念与疏远：')

ok(A.yearning(0) < 0.01, '刚分开：没有挂念')
ok(A.yearning(2) < A.yearning(24), '两小时 < 一天（在涨）')
ok(A.yearning(24) < A.yearning(72), '一天 < 三天（还在涨）')
ok(Math.abs(A.yearning(72) - 1) < 0.01, '第三天到顶', String(A.yearning(72)))
ok(A.yearning(72) > A.yearning(720), '三天之后开始落')
ok(A.yearning(720) > A.yearning(8760), '一个月 > 一年（继续落）')
ok(A.yearning(8760) > A.yearning(26280), '一年 > 三年')
ok(A.yearningPeakHours() === 72, '峰值锚点就是 72 小时', String(A.yearningPeakHours()))

ok(A.estrangement(24) === 0, '一天内不生分')
ok(A.estrangement(720) === 0, '一个月内仍然不生分')
ok(A.estrangement(1440) > 0, '两个月开始有生分')
ok(A.estrangement(8760) > A.estrangement(4320), '半年 < 一年')
ok(A.estrangement(1e6) <= A.ESTRANGE_CAP, '再久也不超过封顶 75%', String(A.estrangement(1e6)))

// 两条轴必须解耦：一年时，挂念很低但疏远也不满
const y1 = A.yearning(8760)
const e1 = A.estrangement(8760)
ok(y1 > 0.1 && y1 < 0.35, '一年后：还惦记（0.1~0.35）', String(y1))
ok(e1 > 0.4 && e1 < 0.7, '一年后：有点生分但不是陌生人', String(e1))

// 恢复不对称
ok(A.recoverYearning() === 0, '挂念：见到人一次清零')
const e0 = 0.6
const e1st = A.recoverEstrangement(e0)
const e2nd = A.recoverEstrangement(e1st)
const e3rd = A.recoverEstrangement(e2nd)
ok(e1st < e0 && e2nd < e1st, '疏远：一轮一轮往下退')
ok(e3rd < 0.4, '三轮之后退到一半以下', e3rd.toFixed(3))

// 人话描述
const d = A.describeAbsence(8760)
ok(d.text.length > 0 && !/[？?]/.test(d.text), '能说一句不带问号的人话', d.text)
ok(A.describeAbsence(0.5).text === '', '刚分开不啰嗦')


// 拆开以后必须各测各的：内容可信 + 时间不可信，是最常见的那种
const mixed2 = { id: 9, title: '他说过的话', confidence: 0.9, born: Date.now(), bornEstimated: true }
ok(U.contentConfidenceOf(mixed2) > 0.8, '内容仍然可信（0.9）')
ok(U.timeConfidenceOf(mixed2) < 0.5, '时间不可信（估的）')
ok(U.shouldMark(mixed2), '这种要标——标的是日期，不是内容')
ok(U.markText(mixed2).includes('日期'), '标注里说的是日期', U.markText(mixed2))

// 没有日期的，不许挨「日期是估的」
const noDate = { id: 10, title: '没写日期', confidence: 0.9 }
ok(!U.shouldMark(noDate), '没日期的不要标')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
