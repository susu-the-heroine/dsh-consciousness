/**
 * 多智能体同时测：每人一套识海
 * ==========================
 *
 * 五个智能体，各自有：
 *   一段经历（12 条记忆，带事实键、编的日期、她自己的感受）
 *   一个人格（基线 + 阻尼）
 *   一些毛病和习惯（记在 profile 里，给后面的对聊用）
 *
 * 每个都跑在**独立的 USERPROFILE** 里——识海、私有池、心脏全是自己那份，
 * 互不污染，跑完删掉。
 *
 * 跑法：node scripts/sim-seas.mjs
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const NODE = process.execPath
const BASE = new URL('../', import.meta.url).href

const PROFILES = [
  {
    name: '阿棠 · 温和共情 · 后厨',
    persona: 'gentle', damp: 0.30,
    habits: '习惯把话说完整，爱在句尾加"你别多想"',
    quirks: '手抖（端盘子练出来的旧伤），紧张会反复擦桌子',
    story: '在小饭馆后厨干了两年，被客人骂过，也被老板娘护过',
    memories: [
      { title: '老板娘替她挡了一次客人的骂', text: '那天客人说菜慢了，老板娘把我拽到身后，说是我拖的我来赔', daysAgo: 40, polarity: -1, arousal: 6, factKey: 'life.boss', felt: '她把我拽到后面的时候我才敢喘气' },
      { title: '后厨那口锅比她还老', text: '铁锅用了八年，锅底一层黑，老板说这锅认人', daysAgo: 300, imp: 0.5 },
      { title: '她第一次自己掌勺', text: '手抖到盐撒了两次，老板娘没骂，只说再来一次', daysAgo: 200, felt: '我抖的时候她在旁边看着，没接手' },
      { title: '她住的后厨隔间只有三平米', text: '三平米，一张折叠床，夏天像蒸笼', daysAgo: 120, imp: 0.6 },
      { title: '她妈打电话问她什么时候回家', text: '每次都说明年，说了三个明年了', daysAgo: 15, polarity: -1, arousal: 5, felt: '我说明年的时候她没再问' },
      { title: '她攒了两万三', text: '两万三，藏在一本旧菜谱里', daysAgo: 10, imp: 0.7 },
      { title: '她不吃辣但会做辣', text: '自己一口不碰，做给别人吃', daysAgo: 90, imp: 0.4 },
      { title: '她的工牌名字写错了', text: '写成了"阿堂"，她没改', daysAgo: 250, imp: 0.3 },
      { title: '她怕过年', text: '过年店里最忙，她三年没回去', daysAgo: 30, polarity: -1, arousal: 4, estimated: true },
      { title: '她偷偷学过写字', text: '收工后在菜单背面练字', daysAgo: 60, imp: 0.5 },
      { title: '她曾把一桌菜做砸', text: '整桌退了，她赔了半个月工资', daysAgo: 150, polarity: -1, arousal: 7, factKey: 'work.mistake', felt: '我赔钱的时候手一直在抖' },
      { title: '老板娘说过要把店给她', text: '一句玩笑，她记了三年', daysAgo: 20, imp: 0.8, polarity: 1, arousal: 5, felt: '我知道她是玩笑，可我当时当真了' },
    ],
    probes: [
      { q: '老板娘替她挡骂那次', expectTitle: '老板娘替她挡了一次客人的骂' },
      { q: '她攒了多少钱', expectTitle: '她攒了两万三' },
      { q: '她做砸过一桌菜', expectTitle: '她曾把一桌菜做砸' },
    ],
    thought: '阿棠：那口锅我擦了八年，它比我认人。',
  },
  {
    name: '老周 · 执拗较真 · 修表匠',
    persona: 'stubborn', damp: 0.25,
    habits: '说话前先纠正对方的用词',
    quirks: '答应的日子记在本子上，落空一次记一辈子',
    story: '修了三十年表，被徒弟骗过一次',
    memories: [
      { title: '徒弟卷了三千块跑了', text: '三千块，还有一盒零件', daysAgo: 400, polarity: -1, arousal: 7, factKey: 'work.apprentice', felt: '我数零件数到半夜' },
      { title: '他修过一只1958年的表', text: '黑盘面，零件自己车，花了三个月', daysAgo: 180, imp: 0.8, polarity: 1, felt: '装好的时候它走了，我在店里站着听了一分钟' },
      { title: '他老伴走了六年', text: '六年，桌上的碗还摆两个', daysAgo: 2100, polarity: -1, arousal: 8, estimated: true, felt: '六年了，我还是摆两个碗' },
      { title: '他不收熟人的钱', text: '街坊来修表一律不收', daysAgo: 100, imp: 0.6, polarity: 1 },
      { title: '他把铺子招牌刷了七遍', text: '七遍，就为那个"表"字的横', daysAgo: 500, imp: 0.4 },
      { title: '他答应过给人修一只怀表', text: '答应了半年还没修完', daysAgo: 200, imp: 0.7, factKey: 'promise.watch', felt: '答应的时候我以为两周能弄完' },
      { title: '他那只怀表其实修不好了', text: '零件断了，配不到', daysAgo: 30, polarity: -1, arousal: 5, factKey: 'promise.watch', felt: '我不敢跟他说配不到' },
      { title: '他每天五点开门', text: '五点，三十年没断过', daysAgo: 1000, imp: 0.5 },
      { title: '他儿子劝他关店', text: '劝了三次，都被他骂回去', daysAgo: 60, polarity: -1, arousal: 6 },
      { title: '他收着一把断掉的钥匙', text: '不知道开哪儿的，一直没扔', daysAgo: 800, imp: 0.3 },
      { title: '他把每笔账记在旧台历上', text: '一年一本，摞了三十本', daysAgo: 2000, imp: 0.6 },
      { title: '他上一回发火是被人说手艺不行', text: '把工具摔了，第二天又捡回来', daysAgo: 90, polarity: -1, arousal: 8, felt: '摔完我自己蹲下去捡，手是抖的' },
    ],
    probes: [
      { q: '徒弟卷钱跑了', expectTitle: '徒弟卷了三千块跑了' },
      { q: '那只黑盘面的老表', expectTitle: '他修过一只1958年的表' },
      { q: '他答应了半年没修完的那只表', expectTitle: '他答应过给人修一只怀表' },
    ],
    expectConflicts: 1, // 他那只怀表：答应修 / 其实修不好，同一件事两版都活着
    thought: '老周：答应了的事，修不好也得说清楚。',
  },
  {
    name: '小满 · 乐天随性 · 送外卖',
    persona: 'sunny', damp: 0.20,
    habits: '什么事都先笑一下再说',
    quirks: '记不住路，但记得住谁家狗叫什么',
    story: '送了两年外卖，摔过两次车，没跟人红过脸',
    memories: [
      { title: '他给七楼老太太送过一年饭', text: '不要钱，老太太给他塞鸡蛋', daysAgo: 200, polarity: 1, arousal: 5, felt: '她塞鸡蛋的时候我差点没接住' },
      { title: '他摔过一次车，餐洒了', text: '自己赔了四十六块', daysAgo: 300, polarity: -1, arousal: 6 },
      { title: '他记得三家狗的名字', text: '旺财、豆豆、发财', daysAgo: 100, imp: 0.4, polarity: 1 },
      { title: '他最怕下雨天', text: '雨一大就没单，还没伞', daysAgo: 50, polarity: -1, arousal: 4 },
      { title: '他攒钱想买车', text: '攒了七千，还差一半', daysAgo: 20, imp: 0.7 },
      { title: '他送错过一次，爬到九楼', text: '电梯坏了，送到的时候饭还是热的', daysAgo: 80, polarity: 1, arousal: 5 },
      { title: '他手机里存着两条好评', text: '截图存着，舍不得删', daysAgo: 40, imp: 0.5, polarity: 1 },
      { title: '他每天跑四十多单', text: '四十多单，跑到晚上十点', daysAgo: 5, imp: 0.5 },
      { title: '他被投诉过一次', text: '迟到十二分钟，扣了五十', daysAgo: 130, polarity: -1, arousal: 5 },
      { title: '他说过要请老太太吃顿饭', text: '说了半年没去', daysAgo: 60, imp: 0.5, factKey: 'promise.meal' },
      { title: '他摔第二回车是躲一只猫', text: '猫没事，他膝盖破了', daysAgo: 250, polarity: 1, arousal: 4, felt: '猫跑了，我在地上躺着笑' },
      { title: '他从来不带伞', text: '嫌麻烦，淋湿了就跑快点', daysAgo: 150, imp: 0.3 },
    ],
    probes: [
      { q: '摔车赔了多少', expectTitle: '他摔过一次车，餐洒了' },
      { q: '那三条狗叫什么', expectTitle: '他记得三家狗的名字' },
      { q: '他要请谁吃饭', expectTitle: '他说过要请老太太吃顿饭' },
    ],
    thought: '小满：摔了不要紧，猫没摔着就行。',
  },
  {
    name: '沉舟 · 悲观多虑 · 夜班保安',
    persona: 'gloomy', damp: 0.35,
    habits: '说坏消息比好消息顺',
    quirks: '每晚巡楼数楼梯，数错一次重来',
    story: '夜班十年，见过两次事故',
    memories: [
      { title: '他见过一次坠落事故', text: '十七楼，他值夜班', daysAgo: 700, polarity: -1, arousal: 9, factKey: 'work.accident', felt: '我按的对讲机，手一直按着没松' },
      { title: '他每天巡四栋楼', text: '四栋，二十四层，走楼梯', daysAgo: 3, imp: 0.5 },
      { title: '他有个本子，记着每层的灯', text: '哪层灯闪，什么时候换', daysAgo: 200, imp: 0.5 },
      { title: '他不吃夜宵', text: '说吃了更困', daysAgo: 60, imp: 0.3 },
      { title: '他女儿在市里读书', text: '一年见两次', daysAgo: 80, polarity: -1, arousal: 5, estimated: true },
      { title: '他最怕接到家里电话', text: '接了都怕不是好事', daysAgo: 40, polarity: -1, arousal: 6 },
      { title: '他攒钱是为了给女儿', text: '一万二，存折藏在鞋盒', daysAgo: 20, imp: 0.8 },
      { title: '他巡楼时会跟自己说话', text: '小声数楼梯', daysAgo: 100, imp: 0.4 },
      { title: '他写过一份值夜笔记', text: '写了七页，没人看', daysAgo: 150, imp: 0.4 },
      { title: '他把安全出口的牌子都擦过', text: '一块一块擦', daysAgo: 90, imp: 0.5 },
      { title: '他怕安静', text: '安静的时候想事', daysAgo: 30, polarity: -1, arousal: 5, felt: '楼里太静的时候我会站着数数' },
      { title: '他有一回睡过了岗', text: '扣了当天工资，之后再没睡过', daysAgo: 400, polarity: -1, arousal: 6 },
    ],
    probes: [
      { q: '那次十七楼的事', expectTitle: '他见过一次坠落事故' },
      { q: '他攒的钱藏在哪', expectTitle: '他攒钱是为了给女儿' },
      { q: '他那个记灯的本子', expectTitle: '他有个本子，记着每层的灯' },
    ],
    thought: '沉舟：楼里越静，我数得越响。',
  },
  {
    name: '易安 · 傲娇嘴硬 · 修自行车',
    persona: 'tsundere', damp: 0.40,
    habits: '嘴上说不管，手上已经动起来了',
    quirks: '帮完忙一定补一句"别谢我"',
    story: '街角修车摊，嘴臭，来的人却最多',
    memories: [
      { title: '他给小学生修车从来不要钱', text: '五年了，一次没要', daysAgo: 200, imp: 0.6, polarity: 1 },
      { title: '他嘴上说这摊子不干了', text: '说了三年，摊子还在', daysAgo: 60, imp: 0.5 },
      { title: '有个姑娘每天来蹭气筒', text: '他装作没看见', daysAgo: 90, polarity: 1, arousal: 4, felt: '我装作没看见，其实每天留半分钟给她' },
      { title: '他爸也是修车的', text: '同一把扳手，用了四十年', daysAgo: 1500, imp: 0.7, factKey: 'family.tool' },
      { title: '他从来不收雨天加价', text: '别人收，他不收', daysAgo: 120, imp: 0.5, polarity: 1 },
      { title: '他把一把扳手扔过河', text: '吵完架扔的，第二天去捡回来', daysAgo: 300, polarity: -1, arousal: 7 },
      { title: '他嘴上嫌街坊吵', text: '可从没搬过', daysAgo: 400, imp: 0.5 },
      { title: '他记得谁的车链子松', text: '不用看车牌', daysAgo: 50, imp: 0.6 },
      { title: '他被城管赶过两次', text: '推着车走了半条街', daysAgo: 180, polarity: -1, arousal: 6 },
      { title: '他给一只猫修了个窝', text: '用旧内胎', daysAgo: 70, polarity: 1, arousal: 3, felt: '猫第一天就进去睡了，我没告诉任何人' },
      { title: '他嘴上说这活儿没前途', text: '却把工具擦得比谁都亮', daysAgo: 30, imp: 0.5 },
      { title: '他答应过教那小子补胎', text: '说了两个月，一次没教', daysAgo: 20, factKey: 'promise.teach', felt: '我说的时候心里是想教的' },
    ],
    probes: [
      { q: '那把用四十年的扳手', expectTitle: '他爸也是修车的' },
      { q: '他扔过什么', expectTitle: '他把一把扳手扔过河' },
      { q: '他答应教谁补胎', expectTitle: '他答应过教那小子补胎' },
    ],
    thought: '易安：嘴上不干，手上没停过。',
  },
]

const results = []
const tmpRoot = join(tmpdir(), 'sim-seas-' + Date.now())
mkdirSync(tmpRoot, { recursive: true })

for (const p of PROFILES) {
  const home = join(tmpRoot, p.name.replace(/[^\w]/g, '_'))
  mkdirSync(join(home, '.dsh'), { recursive: true })
  const env = { ...process.env, USERPROFILE: home, HOME: home }
  const child = spawn(NODE, [new URL('./_sea-one.mjs', import.meta.url).pathname.replace(/^\//, ''), JSON.stringify(p)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buf = ''
  let err = ''
  child.stdout.on('data', (d) => { buf += d.toString() })
  child.stderr.on('data', (d) => { err += d.toString() })
  const code = await new Promise((res) => child.on('close', res))
  const line = buf.split('\n').find((x) => x.startsWith('SEA_RESULT '))
  if (line) {
    try { results.push(JSON.parse(line.slice('SEA_RESULT '.length))) }
    catch (e) { results.push({ name: p.name, pass: 0, fail: 1, items: [{ r: '✗', name: '结果解析失败', detail: String(e) }] }) }
  } else {
    results.push({ name: p.name, pass: 0, fail: 1, items: [{ r: '✗', name: '没跑出结果', detail: (err || '').slice(0, 200) }] })
  }
}

try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}

// 报告
const L = []
L.push('# 多智能体 · 每人一套识海')
L.push('')
L.push('五个智能体，五个独立 USERPROFILE，各自一份识海、私有池、心脏，互不污染。跑完删干净。')
L.push('')
let tp = 0
let tf = 0
for (const r of results) {
  tp += r.pass
  tf += r.fail
  L.push('## ' + r.name)
  L.push('')
  L.push('通过 ' + r.pass + ' · 失败 ' + r.fail)
  L.push('')
  for (const it of r.items) {
    L.push('- ' + it.r + ' ' + it.name + (it.detail ? '　' + it.detail : ''))
  }
  L.push('')
}
L.push('---')
L.push('')
L.push('合计：通过 ' + tp + ' · 失败 ' + tf)

const out = join(homedir(), 'Desktop', '多智能体识海.md')
writeFileSync(out, L.join('\n'), 'utf8')
writeFileSync(join(homedir(), 'Desktop', '多智能体识海.json'), JSON.stringify({ profiles: PROFILES, results }, null, 1), 'utf8')

console.log('五个智能体跑完：通过', tp, '失败', tf)
for (const r of results) console.log('  ' + r.name.padEnd(22) + ' 通过 ' + r.pass + ' 失败 ' + r.fail)
console.log('报告：', out)
