/**
 * 「这是不是主海」判据的自测
 * ==========================
 *   node scripts/guard-main-test.mjs
 *
 * 为什么要它：这份判据是六个脚本「不许碰主库」的唯一守门人，
 * 以前挂在各处、只比字符串（main/../main、MAIN、带空格的都绕得过去）。
 * 2026-11-21 单独给它补一份测试——它是守门人，守门人自己没人看着不行。
 */
import { normSea, isMainSea } from './_guard-main.mjs'

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('通过  ' + name) }
  else { fail++; console.log('失败  ' + name + (extra ? '  → ' + extra : '')) }
}

const yes = ['main', 'MAIN', ' main ', 'main/', 'main\\', './main', 'main/../main', '../main', 'x/../main', 'mAiN/.']
const no = ['沙箱', 'main2', 'main-x', 'xmain', '', '   ', '主海']

for (const s of yes) ok('算主海：' + JSON.stringify(s), isMainSea(s) === true, String(normSea(s)))
for (const s of no) ok('不算主海：' + JSON.stringify(s), isMainSea(s) === false, String(normSea(s)))
ok('空名下归一化成空串', normSea(null) === '' && normSea(undefined) === '')
ok('归一化会把大小写和斜杠都吃掉', normSea(' MAIN/ ') === normSea('main'), normSea(' MAIN/ '))
ok('不许把 main2 当成 main', normSea('main2') !== normSea('main'))

console.log(`\n主海判据：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)