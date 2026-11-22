/**
 * 回归护栏：任何改动前后都跑这一条
 * ================================
 *   node scripts/guard.mjs
 *
 * 挨个跑四套，把关键数打出来，任何一项低于底线就退出码 1：
 *   总自检   ≥122 组全过
 *   拒答闸   9/9
 *   合成库   6/6
 *   灰区     前五 ≥15、空 =0、标了邻条 ≥3
 *
 * 为什么要有它：2026-11-21 晚连着七版拒答闸，每版单看反题都变好，
 * 结果总能蹭掉一两个自检组或灰区一条。以后先跑这条，绿了再谈别的。
 */
import { spawnSync } from 'node:child_process'

const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' })
  return String((r.stdout || '') + (r.stderr || ''))
}

let bad = []

const st = run(['scripts/selftest-all.mjs'])
const stm = st.match(/共 (\d+) 组 · 通过 (\d+) · 失败 (\d+)/)
if (!stm) bad.push('总自检：没读出数')
else {
  const [all, ok, fail] = [Number(stm[1]), Number(stm[2]), Number(stm[3])]
  console.log('  总自检：' + ok + '/' + all + '（失败 ' + fail + '）')
  if (ok < 122 || fail > 0) bad.push('总自检掉了：' + ok + '/' + all)
}

const gate = run(['scripts/refusal-gates-test.mjs'])
const g = gate.match(/通过 (\d+) · 失败 (\d+)/)
if (!g) bad.push('拒答闸：没读出数')
else {
  console.log('  拒答闸：' + g[1] + ' 过 / ' + g[2] + ' 败')
  if (Number(g[1]) < 9 || Number(g[2]) > 0) bad.push('拒答闸掉了')
}

const synth = run(['scripts/eval-synth.mjs'])
const sm = synth.match(/直接命中 (\d+) · 追问确认 (\d+) · 没着落 (\d+)/)
if (!sm) bad.push('合成库：没读出数')
else {
  console.log('  合成库：直接命中 ' + sm[1] + ' · 追问 ' + sm[2] + ' · 没着落 ' + sm[3])
  if (Number(sm[1]) < 6) bad.push('合成库掉了')
}

const gray = run(['scripts/eval-gray.mjs'])
const gm = gray.match(/前五翻到 (\d+)[^\n]*空 (\d+)[^\n]*标了邻条 (\d+)/)
if (!gm) bad.push('灰区：没读出数')
else {
  console.log('  灰区：前五 ' + gm[1] + ' · 空 ' + gm[2] + ' · 标了邻条 ' + gm[3])
  if (Number(gm[1]) < 15 || Number(gm[2]) !== 0 || Number(gm[3]) < 3) bad.push('灰区掉了')
}

if (bad.length) {
  console.log('  结论：不许上——' + bad.join('；'))
  process.exit(1)
}
console.log('  结论：过——四套都在底线以上，可以往下走')
