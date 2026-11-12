/**
 * 同长度配对：把"长短"这个干扰压掉
 * ==============================
 * 上一版学出来的是"短"，不是"像他"。原因：正例和负例的长度分布不一样。
 * 这一版按**每条正例的长度**去找同长度的负例，一条正例配最多三条负例，
 * 然后在配对内部比——长度一样了，比出来的差异才可能是"说话方式"。
 *
 * 跑法：node scripts/pair-shortvoice.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MEM = join(homedir(), '.dsh', '记忆')

function feats(t) {
  const s = String(t || '')
  const n = [...s.trim()].length
  return {
    空格断句: /\s/.test(s.trim()) ? 1 : 0,
    有标点: /[，。？！、；：]/.test(s) ? 1 : 0,
    问号: /[？?]/.test(s) ? 1 : 0,
    感叹: /[！!]/.test(s) ? 1 : 0,
    语气词: /[啊吧呢嘛呗么呀哦喔咯啦嘞呐嗯诶哎嘿哈]/.test(s) ? 1 : 0,
    脏话: /他妈|他吗|傻|草|靠|卧槽|操|屌|妈的|狗/.test(s) ? 1 : 0,
    命令式: /^(你|别|去|先|给|直接|必须|不要|赶紧|马上)/.test(s.trim()) ? 1 : 0,
    否定: /不|没|别|甭/.test(s) ? 1 : 0,
    第一人称: /我/.test(s) ? 1 : 0,
    第二人称: /你|您/.test(s) ? 1 : 0,
    数字: /\d|[一二三四五六七八九十]/.test(s) ? 1 : 0,
    英数混: /[A-Za-z]/.test(s) ? 1 : 0,
    书面腔: /岁月|时光|人生|灵魂|宿命|永恒|汹涌|缱绻|氤氲|斑驳|仿佛|宛若|值得被|皆|乃/.test(s) ? 1 : 0,
    重复词: /(.)\1{2,}/.test(s) ? 1 : 0,
    省略号: /…|\.\.\./.test(s) ? 1 : 0,
    _n: n,
  }
}

// 正例：他的短句
const his = []
for (const f of readdirSync(MEM)) {
  if (!f.endsWith('.md') || f.startsWith('_')) continue
  const t = readFileSync(join(MEM, f), 'utf8')
  for (const m of t.matchAll(/[“「]([^”」\n]{4,40})[”」]/g)) {
    const q = m[1].trim()
    if ([...q].length >= 4) his.push(q)
  }
}
const uniqHis = [...new Set(his)]

// 负例：只用弹幕和评论（干净、无台本标记、无拉丁残留）
const rows = readFileSync(join(MEM, '_外人语料.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const negRaw = rows.filter((r) => r.from === 'danmaku' || r.from === 'comment').map((r) => r.text.replace(/\s+/g, ' ').trim())
const neg = [...new Set(negRaw)].filter((t) => !/[A-Za-z]/.test(t))

// 按长度分桶
const buckets = new Map()
for (const t of neg) {
  const k = [...t].length
  if (!buckets.has(k)) buckets.set(k, [])
  buckets.get(k).push(t)
}

const KEYS = Object.keys(feats('测试')).filter((k) => k !== '_n')
let pairs = 0
const sumHis = {}
const sumNeg = {}
for (const k of KEYS) { sumHis[k] = 0; sumNeg[k] = 0 }

for (const p of uniqHis) {
  const L = [...p].length
  // 同长度；不够就取 ±1
  let cand = buckets.get(L) || []
  if (cand.length < 2) cand = [...(buckets.get(L - 1) || []), ...(buckets.get(L + 1) || [])]
  if (!cand.length) continue
  const fp = feats(p)
  const take = cand.slice(0, 3)
  for (const k of KEYS) sumHis[k] += fp[k]
  for (const n of take) {
    const fn = feats(n)
    for (const k of KEYS) sumNeg[k] += fn[k]
  }
  pairs++
}

console.log('配对成功的正例：', pairs, '/', uniqHis.length, '条｜负例池', neg.length, '条')

const pos = {}
const negm = {}
for (const k of KEYS) {
  pos[k] = sumHis[k] / (pairs || 1)
  negm[k] = sumNeg[k] / (pairs * 3 || 1)
}

console.log('\n特征        他      同长度负例    差')
const weights = {}
let total = 0
for (const k of KEYS) {
  const d = pos[k] - negm[k]
  console.log('  ' + k.padEnd(8) + pos[k].toFixed(3) + '   ' + negm[k].toFixed(3) + '      ' + (d >= 0 ? '+' : '') + d.toFixed(3))
  weights[k] = Math.max(0, d)
  total += weights[k]
}
for (const k of KEYS) weights[k] = Number((weights[k] / (total || 1)).toFixed(3))

// 用配对差异算分：他 vs 同长度负例
const scoreWith = (t) => {
  const f = feats(t)
  let s = 0
  for (const k of KEYS) s += f[k] * weights[k]
  return s * 4 // 放大到好读的区间
}

console.log('\n权重（正的才留）：')
console.log('  ' + KEYS.map((k) => k + ' ' + weights[k]).join('｜'))

const hisScore = uniqHis.map(scoreWith)
const negScore = neg.map(scoreWith)
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1)

// AUC：随机取一对，他高于负例的概率
let greater = 0
let cmp = 0
for (let i = 0; i < hisScore.length; i += 3) {
  for (let j = 0; j < negScore.length; j += 7) {
    cmp++
    if (hisScore[i] > negScore[j]) greater++
    else if (hisScore[i] === negScore[j]) greater += 0.5
  }
}
console.log('\n他 均分 ' + mean(hisScore).toFixed(3) + '｜同长度负例 均分 ' + mean(negScore).toFixed(3))
console.log('AUC = ' + (greater / cmp).toFixed(3) + '（0.5 = 瞎猜，1.0 = 完美分开，0.7 以上算能用）')
