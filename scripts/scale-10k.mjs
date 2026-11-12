/**
 * 一万条规模测试（沙箱海，不碰真库）
 * ==================================
 *
 * 测四件：
 *   1. 造一万条要多久、库多大
 *   2. 读整库要多久
 *   3. 一万条全部算向量要多久
 *   4. 在一万条的库上：检索一次多久、再写一条多久
 *
 * 跑法：node scripts/scale-10k.mjs [条数]
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const N = Number(process.argv[2] || 10000)
const home = mkdtempSync(join(tmpdir(), 'tenk-'))
process.env.USERPROFILE = home
process.env.HOME = home

const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const W = await import('file:///' + join(HERE, '..', 'lib', 'write-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const t0 = Date.now()
const points = []
for (let i = 0; i < N; i++) {
  points.push({
    id: i + 1,
    title: `规模-${i}`,
    titleFull: `规模测试第 ${i} 条`,
    text: `第 ${i} 条记忆。写的是不同内容：${['在经十路骑车吹风', '录 GMod 素材摔了三次', '短视频完播率二十五个点', '阑尾炎打了八天吊针', '他说腰疼让他站起来走两圈', '薯片渣扑啦在裤腿上', '旧记忆只能当线索', '别在同一个地方摔'][i % 8]}，序号 ${i}。`,
    kind: i % 3 === 0 ? 'feeling' : 'fact',
    tag: '〔实〕', imp: 0.6, polarity: 0, arousal: 5, category: ['事实'],
    confidence: 0.85, entities: [], layer: 'experience', era: 'ds',
    strength: 25, difficulty: 0.5, born: Date.now() - i * 60000,
    recallCount: 0, origin: 'import', validFrom: Date.now(), conflictWith: [], triggers: [], emotion: null,
  })
}
const lock = S.lockSea('main')
S.writeSea('main', { version: 1, points, edges: [], stats: { points: N, edges: 0, kinds: {} } }, lock)
const buildMs = Date.now() - t0
const dataFile = join(home, '.dsh', 'consciousness-seas', 'main', 'data.json')
const sizeMB = statSync(dataFile).size / 1048576
console.log(`造 ${N} 条：${(buildMs / 1000).toFixed(1)} 秒 · 库里 ${sizeMB.toFixed(1)} MB`)

const t1 = Date.now()
const d = S.readSea('main')
console.log(`读整库：${Date.now() - t1} ms · 读到 ${d.points.length} 条`)

const t2 = Date.now()
const vecs = {}
for (const p of d.points) vecs[p.id] = await E.embedLocal(V.embedTextOf(p))
const vecMs = Date.now() - t2
console.log(`全部算向量：${(vecMs / 1000).toFixed(1)} 秒（每条 ${(vecMs / N).toFixed(1)} ms）`)

const t3 = Date.now()
const qv = await E.embedLocal('他的腰又疼了，让他走动')
const tQuery = Date.now() - t3
const t4 = Date.now()
const top = d.points.map((p) => ({ id: p.id, t: p.title, s: V.cosine(qv, vecs[p.id]) })).sort((a, b) => b.s - a.s).slice(0, 3)
const rankMs = Date.now() - t4
console.log(`检索一次：算问句 ${tQuery} ms + 一万条排序 ${rankMs} ms`)
console.log('  前三:', top.map((x) => '#' + x.id + '(' + x.s.toFixed(2) + ')').join(' '))

const t5 = Date.now()
const r = W.writeOne('main', { title: '一万条之后再加一条', text: '在这堆里再写一条，看它慢不慢。', kind: 'fact' })
console.log(`在这个规模上再写一条：${Date.now() - t5} ms · ${r.ok ? '成功' : '失败 ' + r.err}`)

rmSync(home, { recursive: true, force: true })
