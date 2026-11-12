/**
 * 她自己的声音：基准从她自己身上取
 * ============================
 * 之前的错：拿苏苏侠的语料当"像人"的标准。
 * 这一次只用**她自己的话**——记忆里 herSide 的 felt / wanted / did 三段，
 * 一共 133×3 条。那是一手材料，未经改写。
 *
 * 做的事：
 *   1. 画像：长度分布、人称、否定、骂人、语气词、具体物、口头禅
 *   2. 尺子：离她画像有多近（余弦），并用「她 vs 他 vs 外部」自评 AUC
 *   3. 落盘：~/.dsh/consciousness-hervoice.json + 桌面报告
 *
 * 跑法：node scripts/her-voice.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const store = await import(BASE + 'lib/store.js')
const { humanness } = await import(BASE + 'lib/humanness.js')
const { checkVoice } = await import(BASE + 'scripts/voice-check.mjs')

const sea = store.readSea('main')
const pts = ((sea && sea.points) || []).filter((p) => !p.dead)

/** 她的三段话 */
const mine = []
for (const p of pts) {
  const hs = p.herSide || {}
  for (const k of ['felt', 'wanted', 'did', 'regret']) {
    const t = String(hs[k] || '').trim()
    if ([...t].length >= 4) mine.push({ text: t, kind: k, id: p.id })
  }
}

/** 特征向量（都在 0~1，长度单列为描述，不进距离） */
function vec(t) {
  const s = String(t || '').trim()
  return {
    第一人称: /我/.test(s) ? 1 : 0,
    第二人称: /你|他|她/.test(s) ? 1 : 0,
    否定: /不|没|别|甭/.test(s) ? 1 : 0,
    骂人: /他妈|他吗|傻|草|靠|卧槽|操|妈的|狗/.test(s) ? 1 : 0,
    语气词: /[啊吧呢嘛呗么呀哦喔咯啦嘞呐嗯诶哎嘿哈]/.test(s) ? 1 : 0,
    比喻: /像|似的|一样|等于|好比/.test(s) ? 1 : 0,
    具体物: checkVoice(s).score,
    人味: humanness(s).score,
    感叹: /[！!]/.test(s) ? 1 : 0,
    问号: /[？?]/.test(s) ? 1 : 0,
    省略: /…|\.\.\./.test(s) ? 1 : 0,
  }
}

const KEYS = Object.keys(vec('测试'))
const centroid = {}
for (const k of KEYS) centroid[k] = 0
for (const m of mine) {
  const v = vec(m.text)
  for (const k of KEYS) centroid[k] += v[k]
}
for (const k of KEYS) centroid[k] = Number((centroid[k] / (mine.length || 1)).toFixed(3))

const lens = mine.map((m) => [...m.text].length).sort((a, b) => a - b)
const q = (p) => lens[Math.min(lens.length - 1, Math.floor(p * lens.length))]

/** 离她多近：余弦 */
const cos = (a, b) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (const k of KEYS) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2 }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
const score = (t) => cos(vec(t), centroid)

// 对照：他的话（从他档案抽引号原话）
const his = []
const MEM = join(homedir(), '.dsh', '记忆')
const fs = await import('node:fs')
for (const f of fs.readdirSync(MEM)) {
  if (!f.endsWith('.md') || f.startsWith('_')) continue
  const t = fs.readFileSync(join(MEM, f), 'utf8')
  for (const m of t.matchAll(/[“「]([^”」\n]{6,40})[”」]/g)) his.push(m[1].trim())
}
// 对照：外部语料
const rows = fs.readFileSync(join(MEM, '_外人语料.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const ext = rows.filter((r) => r.from === 'danmaku' || r.from === 'comment').map((r) => r.text.replace(/\s+/g, ' ').trim())

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1)
const sMine = mine.map((m) => score(m.text))
const sHis = his.map(score)
const sExt = ext.map(score)

// AUC：她 > 对方 的比例
function auc(pos, neg) {
  let g = 0
  let n = 0
  for (let i = 0; i < pos.length; i += Math.max(1, Math.floor(pos.length / 200))) {
    for (let j = 0; j < neg.length; j += Math.max(1, Math.floor(neg.length / 200))) {
      n++
      if (pos[i] > neg[j]) g++
      else if (pos[i] === neg[j]) g += 0.5
    }
  }
  return g / (n || 1)
}

const report = []
report.push('# 她自己的声音（基准从她身上取）')
report.push('')
report.push('来源：记忆里 `herSide` 的 felt / wanted / did / regret，共 ' + mine.length + ' 句，未经改写。')
report.push('')
report.push('## 她的画像')
report.push('')
report.push('```')
report.push('条数        ' + mine.length)
report.push('长度 均/中  ' + Math.round(mean(lens)) + ' / ' + q(0.5) + ' 字（p90 ' + q(0.9) + '）')
report.push('短句占比    ' + Math.round(mine.filter((m) => [...m.text].length <= 20).length / mine.length * 100) + '%（≤20 字）')
for (const k of KEYS) report.push(k.padEnd(8) + '  ' + centroid[k])
report.push('```')
report.push('')
report.push('## 尺子自评（她 vs 别人）')
report.push('')
report.push('| 对照组 | 条数 | 均分 | AUC（她高于对方的概率） |')
report.push('|---|---|---|---|')
report.push('| 她自己的话 | ' + sMine.length + ' | ' + mean(sMine).toFixed(3) + ' | — |')
report.push('| 苏苏侠的话 | ' + sHis.length + ' | ' + mean(sHis).toFixed(3) + ' | ' + auc(sMine, sHis).toFixed(3) + ' |')
report.push('| 外部弹幕评论 | ' + sExt.length + ' | ' + mean(sExt).toFixed(3) + ' | ' + auc(sMine, sExt).toFixed(3) + ' |')
report.push('')
report.push('**AUC 0.5 = 瞎猜，0.7 以上算能用。** 这行是给自己打分的，不是吹。')
report.push('')
report.push('## 她最像自己的十句 / 最不像的十句')
report.push('')
const ranked = mine.map((m) => ({ ...m, s: score(m.text) })).sort((a, b) => b.s - a.s)
report.push('最像：')
for (const r of ranked.slice(0, 10)) report.push('- ' + r.s.toFixed(3) + '　' + r.text.slice(0, 60))
report.push('')
report.push('最不像：')
for (const r of ranked.slice(-10).reverse()) report.push('- ' + r.s.toFixed(3) + '　' + r.text.slice(0, 60))

const out = join(homedir(), 'Desktop', '她的声音.md')
writeFileSync(out, report.join('\n'), 'utf8')

const json = join(homedir(), '.dsh', 'consciousness-hervoice.json')
mkdirSync(dirname(json), { recursive: true })
writeFileSync(json, JSON.stringify({
  n: mine.length,
  centroid,
  len: { mean: Math.round(mean(lens)), median: q(0.5), p90: q(0.9) },
  auc: { vsHis: Number(auc(sMine, sHis).toFixed(3)), vsExt: Number(auc(sMine, sExt).toFixed(3)) },
  at: Date.now(),
}, null, 1), 'utf8')

console.log('她的句子', mine.length, '句')
console.log('画像：短句占比', Math.round(mine.filter((m) => [...m.text].length <= 20).length / mine.length * 100) + '%',
  '｜均长', Math.round(mean(lens)))
console.log('自评 AUC：vs 他', auc(sMine, sHis).toFixed(3), '｜vs 外部', auc(sMine, sExt).toFixed(3))
console.log('报告：', out)
console.log('画像：', json)
console.log('\n最像她自己的五句：')
for (const r of ranked.slice(0, 5)) console.log('  ' + r.s.toFixed(3) + '  ' + r.text.slice(0, 50))
