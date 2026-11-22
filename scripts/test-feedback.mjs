/**
 * 反馈回流：判错要留样本
 * ======================
 *   node scripts/test-feedback.mjs
 *
 * 判 miss/wrong 落一行（问的什么、该是哪条、实际给了哪条）；
 * 判 hit 不落。样本攒着给训练用——不自动重训，换权重得人点头。
 */
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-fb-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea } = await import(LIB + '/store.js')
const { searchTool, judgeTool } = await import(LIB + '/tools.js')
const F = await import(LIB + '/feedback.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

writeSea('main', {
  version: 3,
  points: [
    { id: 1, title: '老周的相机', text: '老周搬走那天把相机落在门口', born: Date.now() - 86400000 },
    { id: 2, title: '阳台上的绿萝', text: '那盆绿萝晒死了', born: Date.now() - 172800000 },
  ],
  edges: [],
})

const r = await searchTool.execute({ query: '老周那个相机后来咋样了', limit: 3, review: false })
const logId = (String(r.log || '').match(/logId[=:：]\s*([A-Za-z0-9_-]+)/) || [])[1]
ok('检索给得出 logId', !!logId, String(r.log).slice(0, 80))

if (logId) {
  const j1 = await judgeTool.execute({ log_id: logId, verdict: 'wrong', expect_id: 2, note: '测回流' })
  ok('判错能记', j1.ok === true, JSON.stringify(j1).slice(0, 80))
  await new Promise((s) => setTimeout(s, 200))
  const lines1 = F.readFeedback()
  ok('判错落了一行', lines1.length === 1, String(lines1.length))
  const rec = lines1[0] || {}
  ok('行里带问题原话', String(rec.q || '').includes('相机'), String(rec.q))
  ok('行里带该哪条与实际哪条', Number(rec.expect) === 2 && Number(rec.got) === 0, JSON.stringify({ e: rec.expect, g: rec.got }))

  const j2 = await judgeTool.execute({ log_id: logId, verdict: 'hit' })
  await new Promise((s) => setTimeout(s, 200))
  ok('判对不落样本', F.readFeedback().length === 1, String(F.readFeedback().length))
  ok('统计报得出可用条数', F.feedbackStats().usable === 1, JSON.stringify(F.feedbackStats()))
}

console.log(`\n反馈回流自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
