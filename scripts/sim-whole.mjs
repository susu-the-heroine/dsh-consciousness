/**
 * 八个智能体，每个跑完整八层
 * =========================
 * 每个智能体有自己的经历、人格、毛病；每个跑在独立 USERPROFILE 里；
 * 三十个同时起（分批），互不干扰。跑完删干净。
 *
 * 跑法：node scripts/sim-whole.mjs [并发数]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const NODE = process.execPath
const CONC = Number(process.argv[2]) || 6

// 第二参数传 seeded 就用真语料长出来的角色，否则用手写的三十份
const SOURCE = String(process.argv[3] || '').toLowerCase() === 'seeded' ? 'seeded' : 'hand'
const { AGENTS30: AGENTS } = await import(SOURCE === 'seeded' ? './agents30-seeded.mjs' : './agents30.mjs')
console.log('档案来源：' + (SOURCE === 'seeded' ? '真语料种子' : '手写三十份') + '（' + AGENTS.length + ' 个）')

const results = []
const root = join(tmpdir(), 'sim-whole-' + Date.now())
mkdirSync(root, { recursive: true })

/** 分批并发 */
async function runBatch(list) {
  const jobs = list.map((p) => {
    const home = join(root, p.name.replace(/[^\w]/g, '_'))
    mkdirSync(join(home, '.dsh'), { recursive: true })
    // 正文不到 12 字会被拒写（这是对的，短得不像一件事）。
    // 测试数据里把短的补齐，别拿它当产品的错。
    const fixedMems = (p.memories || []).map((m) => {
      const txt = String(m.text || '')
      if ([...txt].length >= 12) return m
      return { ...m, text: txt + '，这件事她一直记着' }
    })
    const arg = JSON.stringify({ name: p.name, persona: p.persona, memories: fixedMems, probes: p.probes, thought: p.thought })
    const child = spawn(NODE, [new URL('./_whole-one.mjs', import.meta.url).pathname.replace(/^\//, ''), arg], {
      env: { ...process.env, USERPROFILE: home, HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    let err = ''
    child.stdout.on('data', (d) => { buf += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    return new Promise((res) => {
      child.on('close', () => {
        const line = buf.split('\n').find((x) => x.startsWith('WHOLE_RESULT '))
        if (line) {
          try { res(JSON.parse(line.slice('WHOLE_RESULT '.length))) }
          catch (e) { res({ name: p.name, pass: 0, fail: 1, layers: { 解析: { items: [{ r: '✗', n: '结果解析失败', d: String(e) }] } } }) }
        } else {
          res({ name: p.name, pass: 0, fail: 1, layers: { 启动: { items: [{ r: '✗', n: '没跑出来', d: (err || '').slice(0, 160) }] } } })
        }
      })
    })
  })
  return Promise.all(jobs)
}

for (let i = 0; i < AGENTS.length; i += CONC) {
  const batch = AGENTS.slice(i, i + CONC)
  const r = await runBatch(batch)
  results.push(...r)
}

try { rmSync(root, { recursive: true, force: true }) } catch {}

const L0 = []
L0.push('# 八个智能体 · 每个跑完整八层')
L0.push('')
L0.push('三十个同时起（分批），各一套独立识海（独立 USERPROFILE），跑完删干净。')
L0.push('')
let tp = 0
let tf = 0
const layerAgg = {}
for (const r of results) {
  tp += r.pass
  tf += r.fail
  L0.push('## ' + r.name)
  L0.push('')
  L0.push('通过 ' + r.pass + ' · 失败 ' + r.fail)
  L0.push('')
  for (const [ln, lv] of Object.entries(r.layers || {})) {
    layerAgg[ln] = layerAgg[ln] || { p: 0, f: 0 }
    layerAgg[ln].p += lv.pass || 0
    layerAgg[ln].f += lv.fail || 0
    const bad = (lv.items || []).filter((x) => x.r === '✗')
    L0.push('- **' + ln + '** ' + (lv.pass || 0) + '/' + ((lv.pass || 0) + (lv.fail || 0))
      + (bad.length ? '　失败：' + bad.map((b) => b.n + (b.d ? '（' + b.d + '）' : '')).join('；') : ''))
  }
  L0.push('')
}
L0.push('---')
L0.push('')
L0.push('## 按层汇总')
L0.push('')
for (const [ln, v] of Object.entries(layerAgg)) {
  L0.push('- ' + ln + '：' + v.p + '/' + (v.p + v.f) + (v.f ? '　**有失败**' : ''))
}
L0.push('')
L0.push('合计：通过 ' + tp + ' · 失败 ' + tf)

const out = join(homedir(), 'Desktop', SOURCE === 'seeded' ? '八层全测_语料种子.md' : '八层全测.md')
writeFileSync(out, L0.join('\n'), 'utf8')
writeFileSync(join(homedir(), 'Desktop', SOURCE === 'seeded' ? '八层全测_语料种子.json' : '八层全测.json'), JSON.stringify(results, null, 1), 'utf8')

console.log('八个智能体跑完：通过', tp, '失败', tf)
for (const r of results) console.log('  ' + String(r.name).padEnd(20) + ' 通过 ' + r.pass + ' 失败 ' + r.fail)
console.log('按层：', Object.entries(layerAgg).map(([k, v]) => k + ' ' + v.p + '/' + (v.p + v.f)).join('｜'))
console.log('报告：', out)
