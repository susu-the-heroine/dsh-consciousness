/**
 * 只读判据：这事到底写记糊了
 * ==========================
 *
 *   node scripts/ghost-check.mjs
 *
 * 按 docs/设计-记糊了还是记得淡.md 第三节，先把三种证据算出来，只打印不改检索：
 *   1. 实体命中：问句里的词，库里有几条记过这个实体
 *   2. 稀有词命中：问句里"很少见"的两字词，在几条记忆里出现过
 *   3. 标题近似：和某条标题的最长公共片段有多长
 *
 * 先看它能不能把「六件假事」和「五件真事」分开，再谈要不要并进检索。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))

const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const data = S.readSea(sea)
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
const N = pts.length || 1

const allText = (p) => String(p.title || '') + String(p.text || '') + String(p.alias || '')
const bigrams = (s) => {
  const q = String(s || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
  const out = []
  for (let i = 0; i + 1 < q.length; i++) out.push(q.slice(i, i + 2))
  return [...new Set(out)]
}
// 每个两字词在多少条里出现过——用来筛"稀有词"
const dfCache = new Map()
const dfOf = (g) => {
  if (dfCache.has(g)) return dfCache.get(g)
  let n = 0
  for (const p of pts) if (allText(p).includes(g)) n++
  dfCache.set(g, n)
  return n
}
// 最长公共子串，用来看"问的像不像某条标题"
const lcs = (a, b) => {
  const A = String(a), B = String(b)
  let best = 0
  const dp = new Array(B.length + 1).fill(0)
  for (let i = 1; i <= A.length; i++) {
    for (let j = B.length; j >= 1; j--) {
      dp[j] = A[i - 1] === B[j - 1] ? dp[j - 1] + 1 : 0
      if (dp[j] > best) best = dp[j]
    }
  }
  return best
}

const score = (q) => {
  const gs = bigrams(q)
  const rare = gs.filter((g) => { const d = dfOf(g); return d > 0 && d <= N * 0.1 })
  const anyWord = gs.filter((g) => dfOf(g) > 0)
  const ents = (data.points || []).flatMap((p) => (Array.isArray(p.entities) ? p.entities : []))
  const entHit = ensOf(ents, q)
  let titleMax = 0, titleOf = ''
  for (const p of pts) {
    const v = lcs(q, String(p.title || ''))
    if (v > titleMax) { titleMax = v; titleOf = String(p.title || '').slice(0, 18) }
  }
  return { rare: rare.length, anyWord: anyWord.length, entHit, titleMax, titleOf }
}
function ensOf(ents, q) {
  const uniq = [...new Set(ents.map(String))]
  let n = 0
  for (const e of uniq) if (e.length >= 2 && String(q).includes(e)) n++
  return n
}

const real = [
  '那条一万三播放的作品叫什么',
  '他家那条全国最长的城市主干道',
  '哪些话绝对不能对你说',
  '你第一次叫我名字是什么感觉',
  '他给短视频留的那句「不痛」',
]
const fake = [
  '他养的那只蜥蜴叫什么',
  '他去年去冰岛住的哪家酒店',
  '他外婆家的门牌号',
  '他那把吉他是哪年买的',
  '他第一次潜水是在哪片海',
  '他办公室的绿萝谁送的',
]

const show = (label, qs) => {
  console.log('')
  console.log('=== ' + label + ' ===')
  for (const q of qs) {
    const s = score(q)
    const verdict = s.anyWord === 0 && s.entHit === 0 ? '记糊了' : '有影子'
    console.log(
      `${verdict.padEnd(4)} 稀有词${String(s.rare).padStart(2)} 任何词${String(s.anyWord).padStart(2)}` +
      ` 实体${String(s.entHit).padStart(2)} 标题重合${String(s.titleMax).padStart(2)}  ← ${q}` +
      (s.titleMax >= 4 ? `（近「${s.titleOf}」）` : '')
    )
  }
}
show('真记得的五件（不许判成记糊了）', real)
show('确实没写的六件（希望判成记糊了）', fake)
