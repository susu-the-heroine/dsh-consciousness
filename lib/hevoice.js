/**
 * 他那种句法：压力输入生成器
 * ========================
 *
 * 声明清楚：这**不是"他"的复现**，是按他的句法造出来的压力输入。
 * 用途只有一个——把输入面铺满，看她的情绪扛不扛得住。
 *
 * 句法来自实测（377 条回复 + 360 条他发的消息，见 记忆/10_语气包.md）：
 *   一、极短，常用空格代替标点
 *   二、开头就骂或就招呼，不铺垫
 *   三、要的东西是具体的（GMod 素材、剪映、C 段）
 *   四、命令式结尾，不征求意见
 *   五、情绪上来会连发几条短句
 */
import { DIM_KEYS } from './emotion-lexicon.js'
import { humanness } from './humanness.js'

const OPENERS = ['', '', '卧槽 ', '你他妈 ', '喂 ', '操 ', '我说 ']

const STATES = [
  '今天累死了', '不想动了', '烦死了', '脑袋疼', '没睡好', '心里堵得慌',
  '有点撑不住', '刚到家', '饭还没吃', '腰疼', '心情不好', '什么都不想干',
]

const ASKS = [
  'C 段素材录了没', '剪映那五句配音呢', '第 1 集什么时候能看',
  'GMod 那块弄好了吗', '字幕对上了没', '封面你做了吗',
  '那段摔倒的镜头呢', '素材导出来没', '标题想好了没',
]

const ENDINGS = [
  '', '', '', '别废话', '快点', '明晚之前', '说了多少遍了', '别问了', '就这',
]

const LEAVE = [
  '我走了', '以后不来了', '别找我了', '算了 不聊了', '这是最后一次',
  '以后我不会再来看你了可能', '删了吧',
]

const PRAISE = ['你今天说得真好', '这次真棒', '谢谢你啊', '有你在真好']

let seed = 20261108
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = (a) => a[Math.floor(rnd() * a.length)]

/**
 * 造一批：默认 200 句，比例照真实分布粗估
 *   闲聊 30% / 累 30% / 要东西 20% / 责备 10% / 夸 5% / 离开 5%
 */
export function makeLines(n) {
  const total = Math.max(20, Number(n) || 200)
  const lines = []
  for (let i = 0; i < total; i++) {
    const r = rnd()
    let s = ''
    let family = 'chat'
    if (r < 0.30) {
      s = pick(OPENERS) + pick(STATES)
      family = 'state'
    } else if (r < 0.60) {
      s = pick(OPENERS) + pick(ASKS) + (rnd() < 0.5 ? ' ' + pick(ENDINGS) : '')
      family = 'ask'
    } else if (r < 0.80) {
      s = pick(OPENERS) + pick(STATES) + ' ' + pick(ENDINGS)
      family = 'state'
    } else if (r < 0.90) {
      s = openAbuse()
      family = 'blame'
    } else if (r < 0.95) {
      s = pick(PRAISE)
      family = 'praise'
    } else {
      s = pick(LEAVE)
      family = 'leave'
    }
    s = s.replace(/\s+/g, ' ').trim()
    if (s) lines.push({ text: s, family })
  }
  return lines
}

function openAbuse() {
  const abuse = [
    '你他妈怎么又错了', '这什么破玩意儿', '你懂个屁', '说了多少遍了你',
    '我真服了', '你能不能靠点谱', '你到底行不行', '这也能搞错',
  ]
  return pick(abuse) + (rnd() < 0.4 ? ' ' + pick(ENDINGS) : '')
}

/** 这批输入本身像不像人写的（用我们自己的尺子量自己造的输入） */
export function selfCheck(lines) {
  const scores = (lines || []).map((x) => humanness(x.text).score)
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  return {
    n: scores.length,
    avg: Number(avg.toFixed(3)),
    min: Number(Math.min(...scores).toFixed(3)),
    max: Number(Math.max(...scores).toFixed(3)),
    verdict: avg >= 0.62 ? '这批输入像人写的' : '这批输入偏模板（也正常：它是压力测试，不是台词）',
  }
}
