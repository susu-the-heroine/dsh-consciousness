/**
 * 别名建议器：给没有别名的记忆生成候选问法
 * ==========================================
 *
 * 为什么要有：别名（别人会怎么问）接进向量后，评测头名从 44% 到 61%。
 * 但那是靠人手写三十条换来的——别人装完没有别名，拿不到这个提升。
 * 这个工具把"写别名"变成可跑的流程：先出候选稿，人过一眼，再写回去。
 *
 * 跑法：
 *   node scripts/alias-suggest.mjs [sea]                  # 干跑，只出稿
 *   node scripts/alias-suggest.mjs [sea] --apply --pick 1 # 每条取第 1 个候选写回
 *
 * 生成的是候选，不是定稿；规则抽出来的问法有时很笨，所以要人看一眼。
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const apply = process.argv.includes('--apply')
const pickIdx = (() => {
  const i = process.argv.indexOf('--pick')
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 1) : 1
})()

const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

/** 去掉标题上的装饰：引号、书名号、破折号副题、括号注释 */
function cleanTitle(t) {
  let s = String(t || '')
  s = s.replace(/[「」『』""''《》【】]/g, '')
  s = s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
  s = s.replace(/^关于/, '')
  s = s.split(/——|--|—/)[0]
  return s.trim()
}

/** 从正文里挑一句像"事"的短句，去掉引号里的人名对话 */
function pickSentence(text) {
  const t = String(text || '').replace(/[「」『』""'']/g, '')
  const parts = t.split(/[。！？\n]/).map((x) => x.trim()).filter((x) => x.length >= 6 && x.length <= 34)
  return parts[0] || ''
}

/** 候选问法：三档，从最像人问的到最笨的 */
function candidates(p) {
  const core = cleanTitle(p.title)
  const sent = pickSentence(p.text)
  const out = []
  if (core) {
    out.push(`${core}是怎么回事`)
    out.push(`那次${core}到底是什么情况`)
  }
  if (sent) out.push(sent.replace(/^我/, '你'))
  if (core && sent) out.push(`${core}：${sent.slice(0, 20)}`)
  return [...new Set(out)].filter((x) => x.length >= 6)
}

const lock = S.lockSea(sea)
if (!lock.ok) { console.log('拿不到锁:', lock.err); process.exit(1) }
try {
  const data = S.readSea(sea)
  if (!data || !Array.isArray(data.points)) { console.log('没有这个海'); process.exit(1) }
  const missing = data.points.filter((p) => !p.dead && !String(p.alias || '').trim())
  const rows = []
  let changed = 0
  for (const p of missing) {
    const cands = candidates(p)
    if (!cands.length) continue
    rows.push({ id: p.id, title: p.title, candidates: cands, pick: cands[Math.min(pickIdx, cands.length) - 1] })
    if (apply && rows[rows.length - 1].pick) {
      p.alias = rows[rows.length - 1].pick
      changed++
    }
  }
  if (apply && changed) S.writeSea(sea, data, lock)
  else S.unlockSea(lock)

  const outFile = join(HERE, 'data', `alias-suggest-${sea}.json`)
  writeFileSync(outFile, JSON.stringify(rows, null, 1), 'utf8')
  console.log(`海 ${sea} · 没别名 ${missing.length} 条 · 出了 ${rows.length} 条候选`)
  console.log('审阅稿:', outFile)
  console.log('')
  for (const r of rows.slice(0, 8)) {
    console.log(`#${r.id} ${String(r.title).slice(0, 24)}`)
    for (const c of r.candidates) console.log(`    · ${c}`)
  }
  console.log('')
  console.log(apply ? `已按第 ${pickIdx} 个候选写回 ${changed} 条` : `干跑，没写。确认后加 --apply --pick N`)
} catch (e) {
  try { S.unlockSea(lock) } catch {}
  console.log('出错:', String((e && e.message) || e))
  process.exit(1)
}
