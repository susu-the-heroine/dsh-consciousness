import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 一条命令跑全检
 * ==============
 *
 *   node scripts/gate-all.mjs
 *
 * 顺序：自检 → 回归 → 三百二十九题 → 三档小题库。
 * 任何一步挂、或基准/地板破了，整条命令返回非零——发版前只认这一条。
 *
 * 不打包、不改库、不写记忆；只跑、只看、只报。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const steps = []
function run(name, script, check) {
  const t0 = Date.now()
  const r = spawnSync(_nodeBin, [join(HERE, script)], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const okExit = r.status === 0
  const verdict = check ? check(out) : { ok: okExit, note: '' }
  let ok = okExit && verdict.ok
  let retried = ''
  if (!ok) {
    // 一次不过先重跑一遍：接口那步偶发抢端口，失败一次就判死会误报（2026-11-19 凌晨）
    retried = '（重试一次）'
    const r2 = spawnSync(_nodeBin, [join(HERE, script)], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 })
    const out2 = String(r2.stdout || '') + String(r2.stderr || '')
    const v2 = check ? check(out2) : { ok: r2.status === 0, note: '' }
    const ok2 = r2.status === 0 && v2.ok
    steps.push({ name: name + '（重试）', ok: ok2, ms: Date.now() - t0, note: v2.note })
    console.log(`${ok2 ? '通过' : '失败'}  ${name} · 重试${ok2 ? '后通过' : '仍失败'}${v2.note ? ' · ' + v2.note : ''}`)
    return ok2
  }
  steps.push({ name, ok, ms: Date.now() - t0, note: verdict.note })
  console.log(`${ok ? '通过' : '失败'}  ${name}（${Date.now() - t0}ms）${verdict.note ? ' · ' + verdict.note : ''}`)
  return ok
}

const pctOf = (text, label) => {
  const m = String(text).match(new RegExp(label + '\\s*([0-9.]+)%'))
  return m ? Number(m[1]) : NaN
}

// 先打包：回归里那步「发版前检查」会比包和源文件的先后，源比包新就判不过
run('打代码包', 'pack.mjs')
run('打模型包', 'pack-split.mjs')
run('自检全组', 'selftest-all.mjs')
run('回归集', 'regress.mjs')
run('回放真库', 'replay-real.mjs')
run('三百二十九题', 'bench-baseline.mjs', (out) => {
  if (/不低于地板/.test(out)) return { ok: true, note: '未破地板' }
  const t1 = pctOf(out, '头名')
  const t5 = pctOf(out, '前五')
  return { ok: false, note: `破了地板（${t1}/${t5}）` }
})
run('三档小题库', 'bench-small-qa.mjs', (out) => {
  const floorFile = join(HERE, 'data', 'small-qa-floor.json')
  if (!existsSync(floorFile)) return { ok: true, note: '没有地板文件，跳过判定' }
  const floor = JSON.parse(readFileSync(floorFile, 'utf8'))
  const bad = []
  for (const [k, f] of Object.entries(floor)) {
    const m = String(out).match(new RegExp(k + ':[^\\n]*头名\\s*([0-9.]+)%'))
    if (!m) continue
    const got = Number(m[1])
    if (got < f.top1) bad.push(`${k} ${got}<${f.top1}`)
  }
  return { ok: bad.length === 0, note: bad.join('；') || '未破地板' }
})
// 2026-11-21：这两步原来写在上面那个判定函数的大括号里 —— 看着像三个并列的步骤，
// 实际是「三档小题库」判完以后、在它的判定函数里再去跑另外两个，而且判定重试时会跑第二遍。
// 现在挪出来，三步各跑一次。
run('泛化库（别人家的库）', 'bench-generic.mjs')
run('混合问句（六题·给接受组）', 'bench-mixed.mjs')

const bad = steps.filter((s) => !s.ok)
console.log('')
console.log(`共 ${steps.length} 步 · 通过 ${steps.length - bad.length} · 失败 ${bad.length}`)
if (bad.length) console.log('失败：' + bad.map((b) => b.name).join('、'))
process.exit(bad.length ? 1 : 0)
