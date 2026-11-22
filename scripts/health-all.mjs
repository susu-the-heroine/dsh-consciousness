import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 重启后一次验完
 * ==============
 *
 *   node scripts/health-all.mjs
 *
 * 把该跑的都叫一遍，最后只给一句结论。改完代码重启（cql）之后跑这个。
 * 不跑评测（那个要十七秒建向量），要看检索数字单独跑 eval-fusion / eval-labeled。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE = _nodeBin

// 首次装机：一个识海都没有。这时候跑"全部识海能读""并发写不坏"全是红的——
// 不是坏了，是还没有东西可查。别让人第一次装完就看见四行红。
try {
  // 判据用"有没有自己的 main"，不是"有没有目录"——首次启动会自动铺八个示例海，
  // 那些是样板，不是他的库。只按目录判断，第一次装机还是会看到一片红。
  const mainData = join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json')
  if (!existsSync(mainData)) {
    console.log('这台机器还没有识海（像是第一次装）。')
    console.log('装机自检请跑：node scripts/fresh-home-test.mjs  —— 它自己造临时目录，不碰你的家目录。')
    console.log('等你用它记下第一条记忆、库里有了东西，再回来跑这个健康检查。')
    process.exit(0)
  }
} catch {}

const jobs = [
  { name: '库与预算', script: 'status.mjs', args: [] },
  { name: '全部识海能读', script: 'seas-check.mjs', args: [] },
  { name: '镜像与 JSON 一致', script: 'sqlite-parity.mjs', args: ['main'] },
  { name: '回归集', script: 'regress.mjs', args: [] },
  { name: '一键自检', script: 'selftest-all.mjs', args: [] },
  { name: '发布包干净', script: 'release-audit.mjs', args: [] },
]

let bad = 0
for (const j of jobs) {
  const r = spawnSync(NODE, [join(HERE, j.script), ...j.args], { cwd: join(HERE, '..'), encoding: 'utf8', timeout: 600000 })
  const ok = r.status === 0
  if (!ok) bad++
  const tail = String(r.stdout || '').trim().split('\n').slice(-2).join(' / ')
  console.log(`${ok ? '过' : '挂'}  ${j.name}  ${tail.slice(0, 120)}`)
  if (!ok && r.stderr) console.log('    ' + String(r.stderr).trim().split('\n').slice(0, 3).join('\n    '))
}

console.log('')
console.log(bad === 0 ? '全部通过，可以放心用。' : `有 ${bad} 项没过，先看上面标"挂"的那几行。`)
process.exit(bad === 0 ? 0 : 1)
