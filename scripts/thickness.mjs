/**
 * 厚度体检：一次跑完九块里能自动量的那几块，只出数，不评价。
 *
 * 为什么要有：九块里七块"看着在跑"，没人量过。别人一句"厚度不成熟"，
 * 我们连反驳的数都拿不出来。
 *
 * 规矩：只读，不写库。结果落 ~/.dsh/consciousness-sim/thickness.json。
 * 用法：node scripts/thickness.mjs [http://127.0.0.1:端口]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkVoice } from '../lib/voicecheck.js'

const D = join(homedir(), '.dsh')
const OUT = join(D, 'consciousness-sim')
const base = process.argv[2] || 'http://127.0.0.1:49343'
mkdirSync(OUT, { recursive: true })

const sea = JSON.parse(readFileSync(join(D, 'consciousness-seas', 'main', 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (sea.points || []).filter((p) => !p.dead)
const self = JSON.parse(readFileSync(join(D, 'consciousness-self.json'), 'utf8').replace(/^\uFEFF/, ''))
const thoughts = (self.thoughts || []).filter((x) => !x.archived)

const R = {}

// 一、写入质量：最近 40 条记忆具体不具体、像不像人
{
  let flat = 0, ok = 0
  for (const p of pts.slice(-40)) {
    try {
      const v = checkVoice(String(p.text || ''))
      if (v.score < 0.3) flat++
      else ok++
    } catch { /* 算不出来就不算 */ }
  }
  R.writeQuality = { total: ok + flat, flat, ok, flatRate: ok + flat ? +(flat / (ok + flat)).toFixed(2) : null }
}

// 二、念头质量：最近 20 条念头里多少像人写的
{
  let flat = 0, ok = 0
  for (const t of thoughts.slice(-20)) {
    try {
      const v = checkVoice(String(t.text || ''))
      if (v.score < 0.3) flat++
      else ok++
    } catch {}
  }
  R.thoughtQuality = { total: ok + flat, flat, ok, flatRate: ok + flat ? +(flat / (ok + flat)).toFixed(2) : null }
}

// 三、激素事件分布：最近 40 次喂进去的都判成什么
{
  let body = null
  try { body = JSON.parse(readFileSync(join(D, 'consciousness-body.json'), 'utf8').replace(/^\uFEFF/, '')) } catch {}
  const ev = (body && body.events) || []
  const kinds = {}
  for (const e of ev.slice(-40)) kinds[e.kind] = (kinds[e.kind] || 0) + 1
  R.hormoneEvents = { n: Math.min(40, ev.length), kinds, lastAt: body && body.at ? new Date(body.at).toISOString() : null }
}

// 四、规矩栏：条数 + 有多少条被真的碰到过（靠审计里的关键词，没有就算 0）
{
  const rules = pts.filter((p) => p.rule === true)
  R.rules = { count: rules.length, ids: rules.map((p) => p.id) }
  let hits = 0
  try {
    const log = readFileSync(join(D, 'consciousness-audit.log'), 'utf8')
    hits = (log.match(/"k":"rule-hit"/g) || []).length
  } catch {}
  R.rules.auditHits = hits
}

// 五、抑制：审计里出现过几次"按住了"，几次"放行"
{
  let held = 0, passed = 0
  try {
    const log = readFileSync(join(D, 'consciousness-audit.log'), 'utf8')
    held = (log.match(/"k":"suppress"[^\n]*"speak":false/g) || []).length
    passed = (log.match(/"k":"suppress"[^\n]*"speak":true/g) || []).length
  } catch {}
  R.suppress = { held, passed, everHeld: held > 0 }
}

// 六、身体面板：连抓两次，看有没有东西在动
{
  async function grab() {
    const r = await fetch(base + '/consciousness/body-data?id=main')
    const j = await r.json()
    return j
  }
  try {
    const a = await grab()
    await new Promise((r) => setTimeout(r, 2500))
    const b = await grab()
    const diff = []
    for (const k of ['hourly', 'vitals', 'immune', 'tide', 'drip', 'sediment', 'hormones']) {
      const sa = JSON.stringify(a[k] ?? null)
      const sb = JSON.stringify(b[k] ?? null)
      if (sa !== sb) diff.push(k)
    }
    R.panel = { moved: diff, stable: ['hourly', 'vitals', 'immune', 'tide', 'drip', 'sediment', 'hormones'].filter((k) => !diff.includes(k)) }
  } catch (e) {
    R.panel = { error: String((e && e.message) || e) }
  }
}

// 七、检索：读检索日志，不真跑。
// 为什么改：原来打的是一个不存在的接口（/consciousness/search），
// 一直抓失败，体检表上那一栏是假的。日志里本来就有每次命中几条、有没有被标错。
// 2026-11-11 深夜，苏苏侠说"体检不准，前面所有好坏都是空口"。
{
  try {
    const logFile = join(homedir(), '.dsh', 'consciousness-search-log.jsonl')
    if (!existsSync(logFile)) {
      R.retrieval = { error: '还没有检索日志' }
    } else {
      const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      const rows = []
      const judges = []
      for (const l of lines) {
        try {
          const j = JSON.parse(l)
          if (j.k === 's') rows.push(j)
          else if (j.k === 'j') judges.push(j)
        } catch {}
      }
      const recent = rows.slice(-50)
      const empty = recent.filter((r) => !(r.n > 0)).length
      const avg = recent.length
        ? +(recent.reduce((s, r) => s + (Number(r.n) || 0), 0) / recent.length).toFixed(2)
        : null
      const hit = judges.filter((x) => x.verdict === 'hit').length
      const miss = judges.filter((x) => x.verdict === 'miss').length
      const wrong = judges.filter((x) => x.verdict === 'wrong').length
      R.retrieval = {
        logged: rows.length,
        recent: recent.length,
        emptyRecent: empty,
        avgHits: avg,
        judged: { hit, miss, wrong },
        judgedRate: (hit + miss + wrong) ? +(hit / (hit + miss + wrong)).toFixed(2) : null,
      }
    }
  } catch (e) {
    R.retrieval = { error: String((e && e.message) || e) }
  }
}

// 八、衰减：拿真库算，不读沙箱仿真。
// 之前读 corpus-result.json，那是造出来的三百条测试库，
// 跟他的库没关系——一年后归档多少，得按他自己的数算。
{
  try {
    const _decayUrl = new URL('../lib/decay.js', import.meta.url).href
    const _kindsUrl = new URL('../lib/kinds.js', import.meta.url).href
    const { decayOf } = await import(_decayUrl)
    const { isSetting } = await import(_kindsUrl)
    const live = (sea.points || []).filter((x) => !x.dead)
    const t1 = Date.now() + 365 * 86400000
    let bright = 0, faint = 0, eternal = 0
    for (const x of live) {
      if (isSetting(x) || x.gold) { eternal++; bright++; continue }
      const s = decayOf(x, t1)
      if (s >= 0.3) bright++
      else if (s > 0.06) faint++
    }
    R.decay = { total: live.length, eternal, bright, faint, gone: live.length - bright - faint }
  } catch (e) {
    R.decay = { error: String((e && e.message) || e) }
  }
}

writeFileSync(join(OUT, 'thickness.json'), JSON.stringify(R, null, 1), 'utf8')

console.log('厚度体检（只读）')
const q = R.writeQuality, t = R.thoughtQuality
console.log('写入质量：' + q.total + ' 条里 ' + q.flat + ' 条判泛（' + (q.flatRate != null ? q.flatRate * 100 + '%' : '—') + '）')
console.log('念头质量：' + t.total + ' 条里 ' + t.flat + ' 条判泛（' + (t.flatRate != null ? t.flatRate * 100 + '%' : '—') + '）')
console.log('激素事件：' + JSON.stringify(R.hormoneEvents.kinds))
console.log('规矩：' + R.rules.count + ' 条，审计里被引用 ' + R.rules.auditHits + ' 次')
console.log('抑制：按住 ' + R.suppress.held + ' 次 / 放行 ' + R.suppress.passed + ' 次' + (R.suppress.everHeld ? '' : '（从没按住过）'))
console.log('面板：' + (R.panel.error ? '抓取失败 ' + R.panel.error : '在动的 ' + (R.panel.moved.join(',') || '无') + ' · 没动的 ' + R.panel.stable.join(',')))
{
  const rr = R.retrieval || {}
  if (rr.error) console.log('检索：' + rr.error)
  else console.log('检索：日志里有 ' + rr.logged + ' 次，最近 ' + rr.recent + ' 次里空了 '
    + rr.emptyRecent + ' 次，平均翻出 ' + rr.avgHits + ' 条；标注 '
    + rr.judged.hit + ' 对 / ' + rr.judged.miss + ' 漏 / ' + rr.judged.wrong + ' 错'
    + (rr.judgedRate != null ? '（命中率 ' + (rr.judgedRate * 100).toFixed(0) + '%）' : '（还没标过）'))
}
{
  const d = R.decay || {}
  if (d.error) console.log('衰减：' + d.error)
  else console.log('衰减：真库 ' + d.total + ' 条，一年后还亮 ' + d.bright + ' · 变暗 '
    + d.faint + ' · 归档 ' + d.gone + ' · 一直不淡 ' + d.eternal)
}
console.log('结果：' + join(OUT, 'thickness.json'))
