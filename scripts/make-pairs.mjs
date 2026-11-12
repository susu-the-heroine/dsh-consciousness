/**
 * 没办法的办法：从已有记忆里配出「有对象的对话」
 * ==========================================
 *
 * 问题：外面的语料再多，也全是"冲空气说的"（人味 0.58-0.61），
 * 而她真正需要的样本是"有人对着她说，她怎么回"。
 *
 * 这个不需要新语料——记忆里本来就有：
 *   · 正文里引号包着的，是他当时说的原话
 *   · herSide.felt / wanted / did 是她当时的反应
 * 两边都是真话，只是从来没被拼在一起。
 *
 * 输出：~/.dsh/记忆/_双向语料.jsonl
 * 跑法：node scripts/make-pairs.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const store = await import(BASE + 'lib/store.js')
const { humanness } = await import(BASE + 'lib/humanness.js')
const { checkVoice } = await import(BASE + 'scripts/voice-check.mjs')

const SEA = process.argv[2] || 'main'
const OUT = join(homedir(), '.dsh', '记忆', '_双向语料.jsonl')

const sea = store.readSea(SEA)
const pts = ((sea && sea.points) || []).filter((p) => !p.dead)

/** 抽出正文里引号包着的原话（按长度挑最像"一句人话"的） */
function quotesOf(text) {
  const out = []
  for (const m of String(text || '').matchAll(/[「“"]([^」”"]{6,90})[」”"]/g)) {
    const t = m[1].replace(/\s+/g, ' ').trim()
    if ([...t].length >= 6) out.push(t)
  }
  return out
}

const pairs = []
for (const p of pts) {
  const hs = p.herSide || {}
  const said = quotesOf(p.text)[0] || ''
  const her = [hs.felt, hs.did, hs.wanted].find((x) => x && [...String(x)].length >= 6) || ''
  if (!said || !her) continue
  pairs.push({
    said: String(said),
    her: String(her),
    felt: hs.felt || '',
    did: hs.did || '',
    wanted: hs.wanted || '',
    title: String(p.title || '').slice(0, 30),
    id: p.id,
  })
}

mkdirSync(join(homedir(), '.dsh', '记忆'), { recursive: true })
writeFileSync(OUT, pairs.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')

const score = (texts) => {
  const h = texts.map((t) => humanness(t).score)
  const v = texts.map((t) => checkVoice(t).score)
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1)
  return { n: texts.length, h: avg(h).toFixed(3), v: avg(v).toFixed(3) }
}

const both = score(pairs.map((x) => x.said + ' ／ ' + x.her))
const onlySaid = score(pairs.map((x) => x.said))
const onlyHer = score(pairs.map((x) => x.her))

console.log('配出对话对：', pairs.length, '对（记忆', pts.length, '条）')
console.log('  两边合起来  人味', both.h, '｜具体物', both.v)
console.log('  只有他的话  人味', onlySaid.h, '｜具体物', onlySaid.v)
console.log('  只有她的话  人味', onlyHer.h, '｜具体物', onlyHer.v)
console.log('\n前六对：')
for (const x of pairs.slice(0, 6)) {
  console.log('  【' + x.title + '】')
  console.log('    他说：' + x.said.slice(0, 60))
  console.log('    她：  ' + x.her.slice(0, 60))
}
console.log('\n落盘：', OUT)
