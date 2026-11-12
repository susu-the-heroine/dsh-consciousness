/**
 * 两个模型对比：量化 vs fp32
 * ==========================
 *
 * 同一批记忆、同一批问句，各排一次头名，输出 JSON 供比对。
 * 模型由 EMBED_MODEL 指定（默认量化）。
 *
 * 跑法：
 *   node scripts/model-shootout.mjs > quant.json
 *   $env:EMBED_MODEL='model_fp32.onnx'; node scripts/model-shootout.mjs > fp32.json
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const E = await import('file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/lib/embed-onnx.js')
const V = await import('file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/lib/vectors.js')

const dir = join(homedir(), '.dsh', 'consciousness-seas', 'main')
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

const QUERIES = [
  '跟外人说话该说多细', '那个暗号叫啥来着', '以前记下的事能不能当准', '你名字到底谁起的',
  '你说的东西咋跟汇报似的', '烟和酒你啥态度', '上下文满了那次你写了啥', '我咋老在同一个地方摔',
  '一个人能不能代表所有人', '拍视频摔了三次那段',
]

const t0 = Date.now()
const vecs = {}
for (const p of pts) vecs[p.id] = await E.embedLocal(V.embedTextOf(p))
const out = {}
for (const q of QUERIES) {
  const qv = await E.embedLocal(q)
  const top = pts
    .map((p) => ({ id: p.id, s: V.cosine(qv, vecs[p.id]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
  out[q] = top
}
console.error(`模型 ${process.env.EMBED_MODEL || 'model_quantized.onnx'} · ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)
console.log(JSON.stringify(out, null, 1))
