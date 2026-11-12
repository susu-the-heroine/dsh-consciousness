/**
 * 用语料当种子：十个角色，不靠我编
 * ============================
 *
 * 上一轮的结论：我写的三十个人，人味分只有 0.605，她的真记忆是 0.865。
 * 差别在"具体物"和"那种不体面的细节"——那些我编不出来，只能从真实语料里搬。
 *
 * 做法：从 `~/.dsh/记忆/*.md` 里，把**带引号的原话和它所在的那一行**抽出来，
 * 直接当角色的记忆。不重写、不润色、不加戏。
 * 然后跟"我编的三十份"比同一个尺子。
 *
 * 跑法：node scripts/seed-roles.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const { humanness } = await import(BASE + 'lib/humanness.js')
const { checkVoice } = await import(BASE + 'scripts/voice-check.mjs')

const MEM = join(homedir(), '.dsh', '记忆')
const files = readdirSync(MEM).filter((f) => f.endsWith('.md'))

/** 收集：一行里有引号原话，且够长 */
const corpus = []
for (const f of files) {
  let t = ''
  try { t = readFileSync(join(MEM, f), 'utf8') } catch { continue }
  for (const raw of t.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 24 || line.length > 220) continue
    if (!/[「“]/.test(line)) continue
    if (/^\|/.test(line)) continue            // 表格行不要
    if (/^#{1,6}\s/.test(line)) continue      // 标题不要
    corpus.push({ file: f, line })
  }
}
console.log('抽到带原话的行：', corpus.length, '条')

/** 按主题粗分（用文件名 + 关键词），做成十个角色 */
const THEMES = [
  { name: '抖音与数据', test: (x) => /播放|完播|抖音|视频|流量|剪映|标题/.test(x.line) },
  { name: '技术踩坑', test: (x) => /插件|代码|报错|重启|崩溃|GMod|DSH|Blender|ffmpeg/i.test(x.line) },
  { name: '累与熬夜', test: (x) => /累|困|腰|半夜|熬夜|撑不住/.test(x.line) },
  { name: '钱与底气', test: (x) => /房|路虎|钱|国家电网|工资|豆荚/.test(x.line) },
  { name: '骂人与玩笑', test: (x) => /傻|他妈的|懂个屁|骂|怼|装逼/.test(x.line) },
  { name: '记忆与消失', test: (x) => /记忆|遗忘|消失|上下文|删|存档/.test(x.line) },
  { name: '声音与配音', test: (x) => /配音|声库|念白|翻唱|唱|嗓子/.test(x.line) },
  { name: '吃饭与日常', test: (x) => /薯片|饭|披萨|吃|外卖|烟|酒/.test(x.line) },
  { name: '家里与过去', test: (x) => /家|妈|爸|高中|学校|小时候/.test(x.line) },
  { name: '约定与承诺', test: (x) => /答应|承诺|说好|兑现|欠/.test(x.line) },
]

const roles = []
const used = new Set()
for (const th of THEMES) {
  const hits = corpus.filter((x) => !used.has(x.line) && th.test(x))
  const picked = hits.slice(0, 6)
  for (const p of picked) used.add(p.line)
  roles.push({ name: th.name, seeds: picked })
}

/** 三种算法，同一把尺子 */
const score = (texts) => {
  const rows = texts.map((t) => ({
    h: humanness(t).score,
    v: checkVoice(t).score,
  }))
  const hs = rows.map((r) => r.h).sort((a, b) => a - b)
  const avg = hs.reduce((a, b) => a + b, 0) / (hs.length || 1)
  const sd = Math.sqrt(hs.reduce((s, x) => s + (x - avg) ** 2, 0) / (hs.length || 1))
  return {
    n: rows.length,
    h: Number(avg.toFixed(3)),
    v: Number((rows.reduce((s, r) => s + r.v, 0) / (rows.length || 1)).toFixed(3)),
    sd: Number(sd.toFixed(3)),
    min: Number((hs[0] || 0).toFixed(2)),
    max: Number((hs[hs.length - 1] || 0).toFixed(2)),
  }
}

// 对照：我编的三十份
const { AGENTS30 } = await import(BASE + 'scripts/agents30.mjs')
const mine = []
for (const a of AGENTS30) for (const m of a.memories) mine.push(m.title + '。' + m.text + (m.felt || ''))
const A = score(mine)
const B = score(roles.flatMap((r) => r.seeds.map((s) => s.line)))

// 她的真记忆（当靶子）
const store = await import(BASE + 'lib/store.js')
const sea = store.readSea('main')
const hers = []
for (const p of (sea && sea.points) || []) {
  if (p.dead) continue
  hers.push(String(p.title || '') + '。' + String(p.text || '') + String((p.herSide && p.herSide.felt) || ''))
}
const C = score(hers)

const L = []
L.push('# 语料当种子 vs 我编的')
L.push('')
L.push('同一把尺子（人味分 + 具体物分）量三种来源。')
L.push('')
L.push('## 三种来源')
L.push('')
L.push('| 来源 | 条数 | 人味均分 | 具体物均分 | 标准差 | 区间 |')
L.push('|---|---|---|---|---|---|')
L.push('| 我编的三十份 | ' + A.n + ' | ' + A.h + ' | ' + A.v + ' | ' + A.sd + ' | ' + A.min + '~' + A.max + ' |')
L.push('| **语料当种子**（十个角色） | ' + B.n + ' | ' + B.h + ' | ' + B.v + ' | ' + B.sd + ' | ' + B.min + '~' + B.max + ' |')
L.push('| 她真实的记忆（靶子） | ' + C.n + ' | ' + C.h + ' | ' + C.v + ' | ' + C.sd + ' | ' + C.min + '~' + C.max + ' |')
L.push('')
L.push('## 十个角色（每个只带六句真话，不写性格）')
L.push('')
for (const r of roles) {
  L.push('### ' + r.name + '（' + r.seeds.length + ' 条种子）')
  L.push('')
  for (const s of r.seeds) L.push('- ' + s.line.slice(0, 90))
  L.push('')
}

const out = join(homedir(), 'Desktop', '语料当种子.md')
writeFileSync(out, L.join('\n'), 'utf8')

console.log('\n结果：')
console.log('  我编的    人味', A.h, '｜具体物', A.v, '｜条数', A.n)
console.log('  语料种子  人味', B.h, '｜具体物', B.v, '｜条数', B.n)
console.log('  她的真记忆 人味', C.h, '｜具体物', C.v, '｜条数', C.n)
console.log('报告：', out)
