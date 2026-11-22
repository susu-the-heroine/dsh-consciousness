/**
 * 重启之后，一条命令把三笔欠账验完
 * ================================
 *   node scripts/after-restart-debts.mjs
 *
 * 依次做四件：
 *   一、清掉上次测接口留下的 aliasprobe 残留（占着就报，不硬来）
 *   二、别名能不能存（跑 verify-alias-live）
 *   三、灰区 20 题（前五 / 空 / 错 / 标了邻条）
 *   四、六套回归里最要紧的三套（自检、拒答闸、合成库）
 *
 * 只读主海，写只写沙箱海。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HERE = process.cwd()
const run = (args, label) => {
  console.log('\n==== ' + label + ' ====')
  const r = spawnSync(process.execPath, args, { cwd: HERE, stdio: 'inherit' })
  return r.status === 0
}

const leftovers = join(homedir(), '.dsh', 'consciousness-seas', 'aliasprobe')
if (existsSync(leftovers)) {
  try {
    rmSync(leftovers, { recursive: true, force: true })
    console.log('清掉 aliasprobe 残留：成')
  } catch (e) {
    console.log('清 aliasprobe 残留：还占着（' + (e.code || e.message) + '），多半是老的 sqlite 句柄，下次再来')
  }
} else {
  console.log('aliasprobe 残留：本来就没有')
}

const aliasOk = run(['scripts/verify-alias-live.mjs'], '一、别名能不能存')
const grayOk = run(['scripts/eval-gray.mjs'], '二、灰区 20 题')
const selfOk = run(['scripts/selftest-all.mjs'], '三、总自检')
const gateOk = run(['scripts/refusal-gates-test.mjs'], '四、拒答四道闸')
const synthOk = run(['scripts/eval-synth.mjs'], '五、合成库换词')

console.log('\n==== 结论 ====')
console.log('  别名落盘：' + (aliasOk ? '过' : '不过'))
console.log('  灰区/自检/闸/合成库：' + [grayOk, selfOk, gateOk, synthOk].filter(Boolean).length + '/4 条跑完（具体数看上面）')
console.log('  三笔欠账能不能收，看这一屏。')
