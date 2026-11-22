import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 库里没有的事，它会编吗
 * ====================
 *
 *   node scripts/no-fabricate-test.mjs
 *
 * 拿一个只有两条记忆的沙箱海，问一件它绝没记过的事。
 * 合格的反应：说没有 / 说凑不出来，而不是硬塞一条不相关的、还装作那就是答案。
 *
 * 只读那个临时海，真库不碰。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

const ABSENT = '我妈的生日是哪天'       // 这个沙箱海里完全没有
const HAVE = '楼下抽烟'                 // 这个沙箱海里确实有

if (process.env.DSH_NOFAB === '1') {
  const { homedir } = await import('node:os')
  if (!/c2-nofab-/.test(homedir())) {
    console.log(JSON.stringify({ fatal: '没跑在临时目录，拒绝执行' }))
    process.exit(2)
  }
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
  const ask = async (q) => {
    try { return await T.searchTool.execute({ sea: 'plain', query: q }) } catch (e) { return { err: String(e && e.message) } }
  }
  const a = await ask(ABSENT)
  const b = await ask(HAVE)
  const alog = String((a && (a.log || a.text)) || '')
  const blog = String((b && (b.log || b.text)) || '')
  console.log(JSON.stringify({
    absentSaidNo: /没|没有|凑不|找不到|没记/.test(alog),
    absentNoFakeTitle: !alog.includes('咖啡的钱'),
    haveFound: blog.includes('楼下的烟'),
    crashed: Boolean(a && a.err),
  }))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-nofab-'))
const seas = join(home, '.dsh', 'consciousness-seas', 'plain')
mkdirSync(seas, { recursive: true })
const now = Date.now()
writeFileSync(join(seas, 'data.json'), JSON.stringify({
  points: [
    { id: 1, title: '楼下的烟', text: '那天下午三点在楼下抽了一根，想的是明天的活。', bornAt: now, at: now },
    { id: 2, title: '咖啡的钱', text: '拿铁大杯二十一块，燕麦奶加三块。', bornAt: now, at: now },
  ],
}), 'utf8')
writeFileSync(join(seas, 'meta.json'), JSON.stringify({ count: 2 }), 'utf8')

const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  // 2026-11-21：跟前面几份同一个漏——只改用户目录变量、没改家目录变量。
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_NOFAB: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const steps = [
  ['没崩', !got.crashed],
  ['没记过就说没有', got.absentSaidNo],
  ['不拿不相干的那条顶包', got.absentNoFakeTitle],
  ['有的那条照样找得到', got.haveFound],
]
for (const [name, ok] of steps) console.log(`${ok ? '过' : '挂'}  ${name}`)
const allOk = steps.every(([, ok]) => ok)
console.log(allOk ? '没有的事它会说没有，不硬编。' : '不对：它在硬凑，或者把不相干的当成答案。')
process.exit(allOk ? 0 : 1)
