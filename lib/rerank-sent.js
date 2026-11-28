/**
 * 句子级候选重排（2026-11-28 凌晨）
 *
 * 为什么在这里、不在打分通道：把「文档取最像那句」塞进融合打分，实测掉 2 个点；
 * 只在前 6 到 8 名候选里重排，实测 top1 +1.5、top5 +0.5（T2 200 条，同口径）。
 *
 * 开关：SENT_RERANK_K（默认 6 名）、SENT_RERANK_W（默认 0.6）、SENT_JSON（索引路径）
 * 句向量来源：优先本海 sent.json，退回 SENT_JSON 指定的文件。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join as pjoin } from 'node:path'
import { join } from 'node:path'

let _SENT = null
let _SENT_AT = 0

async function loadIndex(sea) {
  try {
    const V = await import('./vectors.js')
    const m = V.loadSentVecs(sea)
    if (m && m.size) { _SENT = m; _SENT_AT = Date.now(); return m }
  } catch {}
  const now = Date.now()
  if (_SENT && now - _SENT_AT < 60000) return _SENT
  const cands = []
  const ext = String(process.env.SENT_JSON || '')
  if (ext) cands.push(ext)
  for (const p of cands) {
    if (!p || !existsSync(p)) continue
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'))
      const map = new Map()
      for (const [id, arr] of Object.entries(raw || {})) {
        const vs = []
        for (const b64 of arr) {
          const buf = Buffer.from(String(b64), 'base64')
          const q = new Int8Array(buf.buffer, buf.byteOffset, buf.length)
          const f = new Float32Array(q.length)
          for (let i = 0; i < q.length; i++) f[i] = q[i] / 127
          vs.push(f)
        }
        if (vs.length) map.set(Number(id), vs)
      }
      if (map.size) {
        _SENT = map
        _SENT_AT = now
        return map
      }
    } catch {}
  }
  return null
}

const dot = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function sizeOf(sea) {
  try {
    const f = pjoin(homedir(), '.dsh', 'consciousness-seas', String(sea || ''), 'data.json')
    if (!existsSync(f)) return { n: 0, avg: 0 }
    const d = JSON.parse(readFileSync(f, 'utf8'))
    const pts = (d.points || []).filter((x) => x && !x.dead && !x.archived)
    let n2 = 0
    for (const x of pts) n2 += String(x.text || '').length
    return { n: pts.length, avg: pts.length ? n2 / pts.length : 0 }
  } catch {
    return { n: 0, avg: 0 }
  }
}

function avgLenOf(sea) {
  try {
    const f = pjoin(homedir(), '.dsh', 'consciousness-seas', String(sea || ''), 'data.json')
    if (!existsSync(f)) return 0
    const d = JSON.parse(readFileSync(f, 'utf8'))
    const pts = (d.points || []).filter((x) => x && !x.dead && !x.archived)
    if (!pts.length) return 0
    let n = 0
    for (const x of pts) n += String(x.text || '').length
    return n / pts.length
  } catch {
    return 0
  }
}

export async function rerankLog(sea, query, log) {
  // 2026-11-28：只在文档库上用。记忆库实测 top1 掉 9.1 个点（60.8→51.7），
  // 原因是记忆一条就是一件事，切句把它切碎了。门限默认 400 字。
  const minLen = Number(process.env.SENT_RERANK_MINLEN || 400)
  const st = sizeOf(sea)
  // 库太大就不做：一万档实测 top1 掉 1.0、只换回 top3 +1.0，速度还慢 2.5 倍（241→597ms）
  const maxDocs = Number(process.env.SENT_RERANK_MAXDOCS || 5000)
  if (st.n > maxDocs) return log
  if (st.avg && st.avg < minLen) return log
  const K = Math.max(2, Number(process.env.SENT_RERANK_K || 6))
  const W = Number(process.env.SENT_RERANK_W || 0.65)
  const SENT = await loadIndex(sea)
  if (!SENT || !query) return log
  const lines = String(log || '').split('\n')
  const idxs = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#(\d+)/)
    if (m) idxs.push({ i, id: Number(m[1]) })
  }
  if (idxs.length < 2) return log
  const head = idxs.slice(0, K)
  const E = await import('./embed-onnx.js')
  let qv = null
  try { qv = await E.embedLocal(String(query)) } catch { return log }
  if (!qv) return log
  const N = head.length
  const scored = head.map((h, i) => {
    const base = 1 - 0.9 * (i / Math.max(1, N - 1))
    let mx = 0
    const arr = SENT.get(h.id)
    if (arr) for (const sv of arr) { const c = dot(qv, sv); if (c > mx) mx = c }
    return { ...h, s: (1 - W) * base + W * mx }
  })
  scored.sort((a, b) => b.s - a.s)
  const headLines = head.map((h) => lines[h.i])
  const sortedLines = scored.map((x) => lines[x.i])
  const out = lines.slice()
  for (let i = 0; i < head.length; i++) out[head[i].i] = sortedLines[i]
  if (sortedLines.join('\n') === headLines.join('\n')) return log
  return out.join('\n')
}
