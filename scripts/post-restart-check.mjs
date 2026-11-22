/**
 * 重启后五分钟自检：把今夜改的东西一次验完。
 * ==========================================
 *   node scripts/post-restart-check.mjs
 *
 * 只读、不写库；每条都带「该看到什么」。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NODE = process.execPath
const run = (f, args = []) => {
  try { return execFileSync(NODE, [join(HERE, f), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300000 }) }
  catch (e) { return String((e && e.stdout) || '') + String((e && e.stderr) || '') }
}
console.log('一、总自检（该看到 121 组全过）')
const st = run('selftest-all.mjs')
console.log('  ' + (st.trim().split('\n').pop() || '没输出'))

console.log('\n二、两边镜子（两面都该是「一致」）')
for (const sea of ['sandbox', 'main']) {
  const o = run('sqlite-parity.mjs', [sea])
  const line = o.trim().split('\n').filter((x) => x.includes('结论')).pop() || o.trim().split('\n').pop()
  console.log('  ' + sea + '：' + String(line).trim())
}

// 2026-11-21：启动时刻别再靠猜——审计里有 boot-0-webServer 这条，就是进程起来那一刻。
const log = join(homedir(), '.dsh', 'consciousness-audit.log')
const rows = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
const since = rows.filter((r) => Number(r.t) > Date.now() - 6 * 3600 * 1000)

const bootRow = rows.filter((r) => r.k === 'boot-0-webServer').slice(-1)[0]
const bootAt = bootRow ? Number(bootRow.t) : 0
console.log('\n三、审计里那几个计数（重启后该都是零）')
if (bootAt) {
  const mins = ((Date.now() - bootAt) / 60000).toFixed(1)
  // 只有「持有者当时还活着却被拆」才算真漏；pid 已经死了的，那是正常收尸。
  const stAll = rows.filter((r) => Number(r.t) >= bootAt && r.k === 'write-lock-self-stale' && String(r.sea || 'main') === 'main')
  const st = stAll.filter((r) => r.holderAlive === true)
  const stDead = stAll.length - st.length
  console.log('  本次启动：' + new Date(bootAt).toLocaleString('zh-CN') + '（已跑 ' + mins + ' 分钟）')
  console.log('  启动后主海锁过期：' + st.length + ' 次' + (st.length ? '（最后一次 ' + new Date(Number(st.slice(-1)[0].t)).toLocaleTimeString('zh-CN') + '）' : ''))
  // 2026-11-21：零漏有两种——写了没漏、压根没写。后者不算证据，这句必须印出来。
  const mainWrites = rows.filter((r) => Number(r.t) >= bootAt && String(r.sea || '') === 'main' && /^write-/.test(String(r.k))).length
  if (!mainWrites) console.log('  · 这期间主海一笔写都没有——零漏只能算安静，不算干净')
  else console.log('  · 这期间主海写/锁审计 ' + mainWrites + ' 条（有写，零漏才算数）')
  if (st.length && Number(mins) >= 6) console.log('  ※ 跑了六分钟以上还在漏——补丁没生效，或者还有别的漏点')
  if (!st.length && Number(mins) >= 6) console.log('  ✓ 六分钟以上零漏，四分钟那个节律没了')
} else {
  console.log('  审计里没有 boot-0-webServer，认不出启动时刻（旧版可能没记这条）')
}
// 2026-11-21：沙箱的拒绝是测试并发造成的噪音——只数主海，沙箱单列。
for (const k of ['write-lock-self-stale', 'write-lock-timeout', 'write-sea-lock-refused', 'write-lock-release-failed', 'write-sea-fail', 'mirror-sync-failed', 'mirror-deferred-failed', 'backup-vectors-copy-failed', 'sea-meta-write-failed', 'clean-sample-failed', 'write-sea-no-id-blocked']) {
  const all = since.filter((r) => r.k === k)
  const main = all.filter((r) => String(r.sea || 'main') === 'main')
  const box = all.length - main.length
  console.log('  ' + k + '：主海 ' + main.length + (box ? '（沙箱 ' + box + '，测试噪音）' : ''))
  if (main.length) {
    const last = main.slice(-1)[0]
    console.log('     主海最后一次：' + new Date(Number(last.t)).toLocaleString('zh-CN'))
  }
}

console.log('\n四、向量体检（该是缺零、过期零、模型对得上）')
const va = run('vector-audit.mjs', ['main'])
for (const l of va.trim().split('\n').slice(0, 5)) console.log('  ' + l)
console.log('\n五、编造检测器自己正不正常（拿原文当回话该零处，拿编的句子该逮住）')
{
  const t1 = run('check-fabrication.mjs', ['main', '54', 'GMod 里找不到大米饭，最后用了个带盒子的披萨，还扣在脑袋上。'])
  const ok1 = /没有编/.test(t1)
  const t2 = run('check-fabrication.mjs', ['main', '54', '那集是在 gm_construct 拍的，披萨盒扣头上转了三圈。'])
  const ok2 = /gm_construct/.test(t2) && /原文里找不到/.test(t2)
  console.log('  原文原样：' + (ok1 ? '零处（对）' : '反而报了，错'))
  console.log('  编个地图名：' + (ok2 ? '逮住了（对）' : '没逮住，错'))
}

console.log('\n六、随口问与灰区（只报数，别当合格线）')
for (const f of ['eval-casual.mjs', 'eval-gray.mjs']) {
  const o = run(f)
  const line = o.trim().split('\n').filter((x) => x.includes('题'))[0]
  console.log('  ' + (line || f + ' 没输出'))
}