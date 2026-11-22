/**
 * 造一套谁都能跑的题（不碰他的库）
 * ==============================
 *
 *   node scripts/bench-gen.mjs
 *
 * 产出 scripts/data/bench-synth.json：假记忆 + 问题 + 反例。
 * 关键要求：假记忆要像人写的——真名假事、有日期、有情绪、彼此连着边。
 * 种子固定，谁跑都一样。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 固定种子（xorshift32），保证任何人跑出来同一套
let seed = 20261116
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >>> 17
  seed ^= seed << 5; seed >>>= 0
  return seed / 4294967296
}
const pick = (a) => a[Math.floor(rnd() * a.length)]

const PERSON = ['老周', '阿亮', '小满', '他哥', '楼下老板娘', '隔壁老王', '我表姐', '师傅']
const PLACE = ['城南菜市场', '老小区门口', '公司楼下', '经十路边上', '河边', '镇上', '学校后街', '医院门口']
const THING = ['那辆电动车','那台旧相机','那把吉他','那只橘猫','那盆绿萝','那个保温杯','那副羽毛球拍','那盏台灯','那台缝纫机','那只手表','那副墨镜','那台收音机','那口铁锅','那把雨伞','那辆二手摩托','那只仓鼠','那台游戏机','那副护膝','那个电饭锅','那台投影仪','那只八哥','那把电钻','那辆三轮车','那个水壶','那台旧手机','那块滑板','那只乌龟','那台笔记本','那个充电宝','那把剪刀','那副耳机','那台洗碗机','那只兔子','那个鱼缸','那台空调','那辆自行车','那只狗','那把椅子','那台冰箱','那个键盘','那副哑铃','那台扫地机','那只鹦鹉','那台老电视','那个行李箱','那把菜刀','那台打印机','那只蚕','那个风扇','那台净水器','那副球拍','那辆滑板车','那个烟灰缸','那台加湿器','那只蝈蝈','那个挂钟','那把梯子','那台发电机','那只斗鱼','那个铁盒']
const EVENT = ['被偷了', '修好了', '送人了', '摔坏了', '忘在车上', '一直没动', '换了新的', '借出去了']
const FEEL = [
  ['有点心疼', -1, 0.6],
  ['其实无所谓', 0, 0.3],
  ['挺高兴', 1, 0.7],
  ['心里堵', -1, 0.8],
]
const TAIL = ['记得别到处说', '回头再说', '这事先放着', '也就那样', '早晚要还的']

const points = []
const day = 86400000
const now = Date.now()

const TOTAL = Number(process.env.C2_BENCH_N || 120)
for (let i = 0; i < TOTAL; i++) {
  const p = pick(PERSON)
  const pl = pick(PLACE)
  // 大库时物件必须唯一：否则同一件东西挂十条，指代题本身没答案（2026-11-17 抓到）。
  const CN = '一二三四五六七八九十'
  // 后缀必须用汉字：指代只认汉字，挂个阿拉伯数字会解析不出来（2026-11-17 抓到）。
  const th = TOTAL > THING.length ? THING[i % THING.length] + CN[Math.floor(i / THING.length) % 10] : THING[i % THING.length]
  const ev = pick(EVENT)
  const f = pick(FEEL)
  const title = `${p}${th}${ev}`
  const text = `${title}。${p}在${pl}把${th}${ev}，${pick(TAIL)}。${f[0]}。`
  points.push({
    id: i + 1,
    title,
    text,
    born: now - Math.floor(rnd() * 60) * day,
    imp: 0.3 + rnd() * 0.6,
    emo: f[1],
    kind: pick(['fact', 'event', 'emotion']),
    obj: th,
    owner: p,
  })
}

// 问题：从点里抽 30 条真事，配 10 条换说法、10 条错字
const cases = []
const used = new Set()
const take = () => {
  for (let k = 0; k < 50; k++) {
    const p = points[Math.floor(rnd() * points.length)]
    if (!used.has(p.id)) { used.add(p.id); return p }
  }
  return points[0]
}
for (let i = 0; i < 30; i++) {
  const p = take()
  cases.push({ q: p.title, expect: p.id, kind: 'title' })
}
for (let i = 0; i < 10; i++) {
  const p = take()
  // 换说法要留住「说什么东西」——只留「那件事」是在考读心，不是在考记忆
  const who = (p.owner || p.title.slice(0, 2)) + (p.obj || '')
  const q = pick([
    `${who}后来咋样了`,
    `${who}那事儿最后怎么处理的`,
    `后来${who}怎么样了`,
  ])
  cases.push({ q, expect: p.id, kind: 'paraphrase' })
}
for (let i = 0; i < 10; i++) {
  const p = take()
  const t = p.title
  const j = Math.floor(t.length / 2)
  const q = t.slice(0, j) + t.slice(j + 1) // 删一个字，模拟手滑
  cases.push({ q, expect: p.id, kind: 'typo' })
}
// 指着说：上一句提了那件东西，这一句只说「那个东西」
for (let i = 0; i < 10; i++) {
  const p = take()
  const prev = '上次说到' + p.title + '，你还记得吧？'
  const q = pick(['那个东西后来咋样了', '它后来怎么处理的', '那件事后来呢'])
  cases.push({ q, prev, expect: p.id, kind: 'anaphora' })
}
// 反例：库里根本没有的东西
const NEGS = [
  '我养的那条蟒叫什么名字', '他外婆家的门牌号', '去年体检血脂多少', '那套房的首付付了多少',
  '上周三会议记了几条', '他身份证后四位', '车险什么时候到期', '第一次潜水在哪片海',
  '我妈的生日是几号', '那台服务器多少钱买的', '他手机号换了吗', '合同签了几年',
  '那本书作者是谁', '公司年会在哪天', '他腰围多少',
]
for (const q of NEGS) cases.push({ q, expect: null, kind: 'neg' })

// 2026-11-21：目录不在就直接写，会 ENOENT 崩掉整份（实测：在没有 data 子目录的地方跑副本，退出码 1、报 open 失败）。
// scripts/data 十一月十五号被误删过一次，这条路径不是假想。先建目录再写。
mkdirSync(join(HERE, 'data'), { recursive: true })
writeFileSync(join(HERE, 'data', 'bench-synth.json'), JSON.stringify({
  note: '谁能跑的假库题：一百二十条假记忆、三十条标题问答、十条换说法、十条错字、十五条反例。种子固定。',
  points,
  cases,
}, null, 1))

console.log(`假库题造好：${points.length} 条记忆，${cases.length} 道题（负例 ${NEGS.length}）`)
