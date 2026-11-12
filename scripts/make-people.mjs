/**
 * 造人（第二版）：从真语料里长出来
 * ==============================
 * 第一版是我自己写台词，薄——只有标签，没有真话。
 * 这一版改从 ~/.dsh/记忆/_外人语料.jsonl 抽样：
 *   一个人 = 一段真实语料里的说话方式（长度分布、标点习惯、脏字密度）+ 几个毛病标签。
 *
 * 他的"台词"不是模板，是他那份语料里真出现过的句子。
 *
 * 跑法：node scripts/make-people.mjs 60 [seed]
 * 产出：~/.dsh/记忆/_活人.jsonl
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT_DIR = join(homedir(), '.dsh', '记忆')
const OUT = join(OUT_DIR, '_活人.jsonl')
const SRC = join(OUT_DIR, '_外人语料.jsonl')

const N = Math.max(1, Number(process.argv[2] || 60))
const SEED = Number(process.argv[3] || 7)

function rnd(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

if (!existsSync(SRC)) {
  console.error('没找到语料：' + SRC + '（先跑 fetch-voices / harvest-voices）')
  process.exit(1)
}

const rows = readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l) } catch { return null }
}).filter(Boolean)

// 语料里混着一批关键词格式的脏句（形如 M "／我操／你／妈／"），
// 那是分词残留，不是人话。滤掉：斜杠碎词、以单字母引号开头的行。
const isJunk = (t) => /^[A-Za-z]\s*[“"]/.test(t) || /\/.{0,3}\//.test(t) || /[“"]\//.test(t)

const clean = rows.map((r) => String(r.text || '').trim())
  .filter((t) => !isJunk(t))
  .filter((t) => [...t].length >= 3 && [...t].length <= 40)

console.log('语料可用句：', clean.length)

const BUCKETS = [
  { name: '短促', test: (t) => [...t].length <= 8 },
  { name: '中长', test: (t) => [...t].length > 8 && [...t].length <= 20 },
  { name: '长句', test: (t) => [...t].length > 20 },
  { name: '带脏字', test: (t) => /他妈|他吗|操|草|傻|滚|妈的/.test(t) },
  { name: '带问号', test: (t) => /[?？]|吗|么|咋/.test(t) },
  { name: '带语气词', test: (t) => /[啊吧呢嘛呗呀哈哦]/.test(t) },
]

const indexed = BUCKETS.map((b) => ({ ...b, pool: clean.filter(b.test) }))
for (const b of indexed) console.log('  ' + b.name + '：' + b.pool.length)

const FLAWS = ['嘴上不饶人，心里软', '急起来就骂人，骂完又后悔', '爱抬杠',
  '说反话当表扬', '一累就不说话', '喜欢用反问代替回答',
  '夸人只夸东西不夸人', '生气时把标点全丢了', '老爱说"我错了"其实不认',
  '听不得别人说自己不行', '爱拿过去的事压人', '开玩笑没轻没重']
const JOBS = ['高三学生', '开货车的', '修空调的', '写代码的', '饭馆老板', '剪视频的',
  '体育老师', '铺地砖的', '网吧网管', '卖水果的', '退伍兵', '夜班保安']
const HOMES = ['济南经十路', '济南天桥', '章丘', '青岛李沧', '临沂', '潍坊', '泰安', '淄博']
const AGES = [17, 19, 22, 26, 31, 38, 45, 52]

const r = rnd(SEED)
const people = []
for (let i = 0; i < N; i++) {
  const main = indexed[i % indexed.length]
  const extra = indexed[Math.floor(r() * indexed.length)]
  const lines = []
  for (let k = 0; k < 12; k++) {
    const pool = (r() < 0.7 ? main : extra).pool
    if (!pool.length) continue
    lines.push(pool[Math.floor(r() * pool.length)])
  }
  people.push({
    id: 'q' + (i + 1),
    age: AGES[Math.floor(r() * AGES.length)],
    job: JOBS[Math.floor(r() * JOBS.length)],
    home: HOMES[Math.floor(r() * HOMES.length)],
    style: main.name,
    flaws: [FLAWS[Math.floor(r() * FLAWS.length)], FLAWS[Math.floor(r() * FLAWS.length)]],
    lines: [...new Set(lines)],
  })
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, people.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8')
console.log('\n造了', people.length, '个人 →', OUT)
for (const p of people.slice(0, 3)) {
  console.log('  ' + p.id + ' ' + p.age + '岁 ' + p.job + ' · ' + p.style + ' · ' + p.flaws[0])
  console.log('    ' + p.lines.slice(0, 4).join(' ／ '))
}
