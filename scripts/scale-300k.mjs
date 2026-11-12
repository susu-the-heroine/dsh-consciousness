/**
 * 三十万条规模测试
 * ================
 *
 * 为什么抽样：算向量是 13 ms/条，三十万条要 65 分钟，那是"补历史"的一次性成本，
 * 不是日常。这里要量的是**存储、读、排序、写入**在三十万条时什么样。
 * 所以真算 2000 条向量，其余循环复用——排序与余弦的代价是真的（三十万 × 512 = 1.5 亿次乘加）。
 *
 * 跑法：node scripts/scale-300k.mjs [条数]
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const N = Number(process.argv[2] || 300000)
const SAMPLE = 2000

const home = mkdtempSync(join(tmpdir(), 'k300-'))
process.env.USERPROFILE = home
process.env.HOME = home

const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const W = await import('file:///' + join(HERE, '..', 'lib', 'write-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const FACT = ['在经十路骑车吹风', '录 GMod 素材摔了三次', '短视频完播率二十五个点', '阑尾炎打了八天吊针', '他说腰疼让他站起来走两圈', '薯片渣扑啦在裤腿上', '旧记忆只能当线索', '别在同一个地方摔']
const t0 = Date.now()
const points = new Array(N)
for (let i = 0; i < N; i++) {
  points[i] = {
    id: i + 1, title: `规模-${i}`, titleFull: `规模测试第 ${i} 条`,
    text: `第 ${i} 条记忆。${FACT[i % 8]}，序号 ${i}。`,
    kind: i % 3 === 0 ? 'feeling' : 'fact', tag: '〔实〕', imp: 0.6, polarity: 0, arousal: 5,
    category: ['事实'], confidence: 0.85, entities: [], layer: 'experience', era: 'ds',
    strength: 25, difficulty: 0.5, born: Date.now() - i * 1000,
    recallCount: 0, origin: 'import', validFrom: Date.now(), conflictWith: [], triggers: [], emotion: null,
  }
}
const lock = S.lockSea('main')
S.writeSea('main', { version: 1, points, edges: [], stats: { points: N, edges: 0, kinds: {} } }, lock)
const dataFile = join(home, '.dsh', 'consciousness-seas', 'main', 'data.json')
console.log(`造 ${N} 条：${((Date.now() - t0) / 1000).toFixed(1)} 秒 · 库里 ${(statSync(dataFile).size / 1048576).toFixed(1)} MB`)

const t1 = Date.now()
const d = S.readSea('main')
console.log(`读整库：${Date.now() - t1} ms · ${d.points.length} 条 · RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`)

// 抽 2000 条真算，其余复用
const t2 = Date.now()
const samplePts = d.points.slice(0, SAMPLE)
const sampleTexts = samplePts.map((p) => V.embedTextOf(p))
const sampleVecs = []
for (let i = 0; i < sampleTexts.length; i += 8) {
  const chunk = sampleTexts.slice(i, i + 8)
  const vs = await E.embedBatch(chunk)
  for (const v of vs) sampleVecs.push(v)
}
const sampleMs = Date.now() - t2
const perPoint = sampleMs / SAMPLE
console.log(`真算 ${SAMPLE} 条向量：${(sampleMs / 1000).toFixed(1)} 秒（${perPoint.toFixed(1)} ms/条）→ 三十万条全算要 ${((perPoint * N) / 60000).toFixed(0)} 分钟`)

const t3 = Date.now()
const vecs = new Array(N)
for (let i = 0; i < N; i++) vecs[i] = sampleVecs[i % SAMPLE]
console.log(`铺满 ${N} 条向量（复用）：${Date.now() - t3} ms · RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`)

const t4 = Date.now()
const qv = await E.embedLocal('他的腰又疼了，让他走动')
const tQuery = Date.now() - t4
const t5 = Date.now()
let best = { id: 0, s: -1 }
for (let i = 0; i < N; i++) {
  const s = V.cosine(qv, vecs[i])
  if (s > best.s) best = { id: d.points[i].id, s }
}
const rankMs = Date.now() - t5
console.log(`检索一次：算问句 ${tQuery} ms + 三十万条求最大 ${rankMs} ms（结果 #${best.id} ${best.s.toFixed(2)}）`)

const t6 = Date.now()
const r = W.writeOne('main', { title: '三十万之后再写一条', text: '在这个规模上再写一条，看连边要多久。', kind: 'fact' })
console.log(`三十万条时再写一条：${Date.now() - t6} ms · ${r.ok ? '成功' : '失败 ' + r.err}`)

rmSync(home, { recursive: true, force: true })
