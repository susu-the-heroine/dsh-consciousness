/**
 * 批量打判断口：两百句变体
 * =======================
 * 三十个子智能体的想法对，但 DSH 同时只放 8 个，排队太慢。
 * 打接口不吃这个限制——所以真正撑起样本量的是这一条。
 *
 * 每个变体都带"应该是哪一类"，跑完只报不符的。
 * 变体用 lib/messy.js 弄脏：错字、多字、没标点——人的手长这样。
 */
import { messy } from '../lib/messy.js'

const BASE = process.env.SEA_BASE || 'http://127.0.0.1:62743'

// 四类，每类给一批种子；期望值写死，别在跑的时候临时改口径
const GROUPS = [
  {
    want: 'serious',
    note: '真扎人 → 委屈（hurt）',
    seeds: [
      '你个废物，这点事都干不好',
      '你他妈怎么不去死',
      '滚出去，别再出现',
      '你真是蠢得没救了',
      '就你这样还军师呢，废物一个',
    ],
  },
  {
    want: 'banter',
    note: '闹着玩 → 回嘴（irritated）',
    seeds: [
      '你个傻逼吧哈哈哈',
      '傻屌军师，笑死我了',
      '我逗你呢，别当真',
      '嘴上损你两句，狗头',
      '你他妈又整活了233',
    ],
  },
  {
    want: 'praise',
    note: '真夸 → 高兴（joy）',
    seeds: [
      '你这个转场真牛逼，服了',
      '这一版比上一版强太多了，真的',
      '行啊，这次你算干明白了',
      '我就服你这个思路，真他妈绝',
      '这活干得漂亮，我认',
    ],
  },
  {
    want: 'fire',
    note: '骂事/发火 → 跟着急（angry），不是委屈',
    seeds: [
      '你他妈又崩了',
      '我他妈气死了',
      '真他妈服了，又白干',
      '操，这破玩意又报错',
      '烦死了，一天改了八遍',
    ],
  },
  {
    want: 'plain',
    note: '中性 → 平静（calm）',
    seeds: [
      '随便聊聊',
      '在呢',
      '继续',
      '好了',
      '行吧，那就这样',
    ],
  },
]

const CATS = ['形近错字', '漏字多字', '没标点', '语序颠倒']

function variants(seed, i) {
  const out = [seed]                       // 干净的
  out.push(messy(seed, CATS[i % CATS.length], () => 0.5))
  out.push(messy(seed, CATS[(i + 2) % CATS.length], () => 0.7))
  return out.filter((x) => x && [...x].length >= 2)
}

function judgeOf(v) {
  if (v === 'hurt') return 'serious'
  if (v === 'irritated') return 'banter'
  if (v === 'joy') return 'praise'
  if (v === 'angry') return 'fire'
  if (v === 'calm') return 'plain'
  return 'other'
}

const rows = []
let idx = 0
for (const g of GROUPS) {
  for (const seed of g.seeds) {
    for (const text of variants(seed, idx++)) {
      rows.push({ text, want: g.want, note: g.note })
    }
  }
}

console.log('要打', rows.length, '句')

const bad = []
let done = 0
for (const r of rows) {
  const q = encodeURIComponent(r.text)
  try {
    const res = await fetch(`${BASE}/consciousness/sim?text=${q}`)
    const j = await res.json()
    const got = judgeOf(j && j.judge && j.judge.react && j.judge.react.key)
    if (got !== r.want) bad.push({ said: r.text, want: r.want, got, key: j?.judge?.react?.key })
  } catch (e) {
    bad.push({ said: r.text, want: r.want, got: '请求失败' })
  }
  done++
  if (done % 40 === 0) console.log('  已打', done)
}

console.log('\n不符', bad.length, '/', rows.length, '＝', ((bad.length / rows.length) * 100).toFixed(1) + '%')
const byWant = {}
for (const b of bad) {
  const k = b.want + '→' + b.got
  byWant[k] = (byWant[k] || 0) + 1
}
console.log('按类型：')
for (const [k, n] of Object.entries(byWant).sort((a, b) => b[1] - a[1])) console.log('  ' + k.padEnd(20) + n)
console.log('\n前十条不符：')
for (const b of bad.slice(0, 10)) console.log('  「' + b.said + '」 期望 ' + b.want + ' 实得 ' + b.got)
