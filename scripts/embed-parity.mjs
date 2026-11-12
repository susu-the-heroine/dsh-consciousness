/**
 * 本地推理与模型版对齐验证
 * ========================
 *
 * 同一批问句，用本地 ONNX（量化模型）算一遍，跟 torch 那边算的比余弦。
 * 低于 0.99 就说明分词或池化接错了——不许拿这种向量进库。
 *
 * 跑法：node scripts/embed-parity.mjs [问句向量.json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const qfile = process.argv[2] || join(tmpdir(), 'bge-qvecs.json')

const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())
const J = await import('file:///' + join(HERE, '..', 'lib', 'embed-js.js').replace(/\\/g, '/') + '?v=' + Date.now())

if (!existsSync(qfile)) { console.log('没有问句向量文件：' + qfile); process.exit(1) }
const ref = JSON.parse(readFileSync(qfile, 'utf8'))

const cos = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

let pass = 0
let fail = 0
console.log('问句'.padEnd(22), '余弦', ' 判定')
const worst = { cos: 1, q: '' }
for (const [q, want] of Object.entries(ref)) {
  let v
  try {
    v = await E.embedLocal(q)
  } catch (e) {
    fail++
    console.log(q.padEnd(22), '出错', String(e && e.message).slice(0, 70))
    continue
  }
  const c = cos(v, want)
  if (c < worst.cos) { worst.cos = c; worst.q = q }
  const ok = c >= 0.99
  if (ok) pass++
  else fail++
  console.log(q.padEnd(22), c.toFixed(4), ok ? '✓' : '✗ 分词或池化不对')
}
console.log('')
console.log(`通过 ${pass} · 失败 ${fail} · 最差 ${worst.cos.toFixed(4)}（${worst.q}）`)
console.log('说明：对照的是 fp32 模型算的向量，本地跑的是量化版，天然会差一点点；0.99 以上算接对。')
process.exit(fail ? 1 : 0)
