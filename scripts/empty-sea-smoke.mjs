import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 空库不炸：别人刚装、还没记过任何东西时，检索能不能正常说话
 * ==========================================================
 *
 *   node scripts/empty-sea-smoke.mjs
 *
 * 这个脚本自己造一个临时 HOME（里面什么海都没有），再调检索的入口。
 * 要的结果：不抛异常、返回空数组、不写任何文件到真实家目录。
 *
 * 为什么单拎出来测：他机器上永远有二百多条，永远看不出"空库"什么反应；
 * 而新装的人第一分钟就是空库。
 */
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

if (process.env.DSH_EMPTY_SEA_CHILD === '1') {
  // 子进程：在临时 HOME 里跑真正的检索入口
  const C = await import('file:///' + join(ROOT, 'lib', 'candidates.js').replace(/\\/g, '/'))
  const out = { ok: true, err: '', samples: [] }
  try {
    const a = C.ftsCandidates('main', '今天干了什么', 10)
    out.samples.push(['ftsCandidates', Array.isArray(a) ? a.length : String(a)])
    const b = await C.vectorCandidates('main', '今天干了什么', 10)
    out.samples.push(['vectorCandidates', Array.isArray(b) ? b.length : String(b)])
    const c = await C.candidatesFor('main', '今天干了什么')
    out.samples.push(['candidatesFor', Array.isArray(c) ? c.length : (c && typeof c === 'object' ? Object.keys(c).length : String(c))])
  } catch (e) {
    out.ok = false
    out.err = String((e && e.message) || e)
  }
  console.log(JSON.stringify(out))
  process.exit(out.ok ? 0 : 1)
}

const home = mkdtempSync(join(tmpdir(), 'dsh-empty-'))
const r = spawnSync(_nodeBin, [fileURLToPath(import.meta.url)], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, DSH_EMPTY_SEA_CHILD: '1', USERPROFILE: home, HOME: home },
})

let ok = r.status === 0
let parsed = null
try { parsed = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!parsed) { ok = false; console.log('子进程没给出结果：' + String(r.stderr || '').slice(0, 200)) }

const leftovers = existsSync(join(home, '.dsh')) ? readdirSync(join(home, '.dsh')) : []
if (leftovers.length) { ok = false; console.log('空库检索居然往家目录写了东西：' + leftovers.join(', ')) }
if (parsed && parsed.err) console.log('抛了：' + parsed.err)

console.log(`空库：${ok ? '不炸、也不落盘' : '有问题'}` + (parsed && parsed.samples ? ' · ' + parsed.samples.map((x) => x[0] + '=' + x[1]).join(' · ') : ''))
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(ok ? 0 : 1)
