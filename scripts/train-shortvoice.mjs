/**
 * 从数据里学"短句像不像他"
 * =====================
 * 上一把尺子是我拍的权重，结果把剧本排得比他还高——拍的不算数。
 *
 * 这一次反过来：把他的 601 条短句当正例，剧本对白、弹幕当负例，
 * 用特征均值差算权重（差值越大的特征越区分），再验分离度。
 * 权重写进 ~/.dsh/consciousness-shortvoice.json，可热调。
 *
 * 跑法：node scripts/train-shortvoice.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const MEM = join(homedir(), '.dsh', '记忆')

/** 特征：都用 0/1 或可归一的值，别让量纲打架 */

// 特征只留一份：训练和线上都从 lib 拿
import { feats } from '../lib/shortvoice-model.js'

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1)

function collect() {
  const his = []
  for (const f of readdirSync(MEM)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue
    const t = readFileSync(join(MEM, f), 'utf8')
    for (const m of t.matchAll(/[“「]([^”」\n]{4,40})[”」]/g)) {
      // **不要压缩空格**：他的习惯就是"空格断句"，压缩掉等于把他的特征洗没了
      const q = m[1].trim()
      if ([...q].length >= 4) his.push(q)
    }
  }
  const rows = readFileSync(join(MEM, '_外人语料.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  const script = rows.filter((r) => r.domain === '剧本').map((r) => r.text)
  const danmaku = rows.filter((r) => r.from === 'danmaku').map((r) => r.text)
  const novel = rows.filter((r) => r.domain === '网文').map((r) => r.text)
  // 负例里要放"真正要防的那种话"：AI 自己写的短句。
  // 之前负例只有剧本/弹幕/网文，等于让尺子学"像不像弹幕"，不是"像不像 AI"。
  let ai = []
  try {
    ai = readFileSync(join(MEM, '_AI短句.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l).text } catch { return '' } })
      .filter(Boolean)
  } catch {}
  // 弹幕只留一部分：它太碎，占满了会把"AI 味"淹掉
  const dan = danmaku.slice(0, 4000)
  return { his: [...new Set(his)], neg: [...ai, ...ai, ...script, ...dan, ...novel] }
}

const { his, neg: negRaw } = collect()
// 负例只留 5~40 字，和他的短句同区间——不然又变成"长短对比"
const neg = negRaw.filter((t) => { const n = [...t].length; return n >= 5 && n <= 40 })
console.log('正例', his.length, '条｜负例', neg.length, '条（已按 5~40 字对齐）')
const KEYS = Object.keys(feats('测试'))
const posMeans = {}
const negMeans = {}
for (const k of KEYS) {
  posMeans[k] = mean(his.map((t) => feats(t)[k]))
  negMeans[k] = mean(neg.map((t) => feats(t)[k]))
}
// 权重 = 正负均值差；只保留朝正方向的特征
const weights = {}
let sum = 0
for (const k of KEYS) {
  const d = posMeans[k] - negMeans[k]
  // 负权重实测更差（AUC 0.662 -> 0.588），所以只留正的。
  // AI 味那条靠 shortVoice 单独扣，不进这里。
  weights[k] = Math.max(0, d)
  sum += weights[k]
}
for (const k of KEYS) weights[k] = Number((weights[k] / (sum || 1)).toFixed(4))

const score = (t) => {
  const f = feats(t)
  let s = 0
  for (const k of KEYS) s += f[k] * weights[k]
  // 归一：满分就是全命中
  return Math.max(0, Math.min(1, s))
}

const stat = (arr, name) => {
  const s = arr.map(score)
  const sorted = [...s].sort((a, b) => a - b)
  const avg = mean(s)
  console.log('  ' + name.padEnd(10) + String(arr.length).padStart(6) + ' 条   均分 ' + avg.toFixed(3) + '   中位 ' + sorted[Math.floor(sorted.length / 2)].toFixed(3))
  return avg
}

console.log('学出来的权重（正的才留）：')
for (const k of KEYS) {
  const d = (posMeans[k] - negMeans[k]).toFixed(3)
  console.log('  ' + k.padEnd(8) + ' 他 ' + posMeans[k].toFixed(2) + '  负例 ' + negMeans[k].toFixed(2) + '  差 ' + d + '  权重 ' + weights[k])
}

console.log('\n分离度：')
const a = stat(his, '他的短句')
const b = stat(neg, '外来短句')
function auc(pos, negArr) {
  const ps = pos.map(score)
  const ns = negArr.map(score)
  let win = 0
  for (const p of ps) for (const n of ns) {
    if (p > n) win += 1
    else if (p === n) win += 0.5
  }
  return win / (ps.length * ns.length || 1)
}
console.log('\nAUC（0.5=瞎猜，0.7=能用）：' + auc(his, neg).toFixed(3))

console.log('\n差 ' + (a - b).toFixed(3) + '（正数才算分得开）')

const out = join(homedir(), '.dsh', 'consciousness-shortvoice.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ weights, posMean: Number(a.toFixed(3)), negMean: Number(b.toFixed(3)), n: { his: his.length, neg: neg.length }, at: Date.now() }, null, 1), 'utf8')
console.log('权重落盘：', out)
