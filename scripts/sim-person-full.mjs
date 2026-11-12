/**
 * 整个人机对话：一百轮，走完整条链
 * =================================
 * 不是测某个模块——每一轮都按真实路径走：
 *   他说话 → 判情绪 → 出注入 → （每五轮）写一条记忆 → 搜回来 → 页面里能不能看见
 *
 * 判"错"的口径只有三类，都是硬伤：
 *   1. 注入里没有「她这会儿」这行
 *   2. 情绪判出一个没名字的键（页面上会显示"说不清"）
 *   3. 写进去的记忆搜不回来 / 页面里没有
 *
 * 跑法：node scripts/sim-person-full.mjs [基地址]
 */
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:50740'
const SEA = 'talktest'
const seaDir = join(homedir(), '.dsh', 'consciousness-seas', SEA)

const base = 'file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/'
const store = await import(base + 'lib/store.js')
const T = await import(base + 'lib/tools.js')

try { if (existsSync(seaDir)) rmSync(seaDir, { recursive: true, force: true }) } catch {}
store.writeSea(SEA, { version: 1, points: [], edges: [], createdAt: Date.now() })

const get = async (p) => {
  const r = await fetch(BASE + p)
  return { status: r.status, body: await r.text() }
}

// 五个"人"，每人二十句，带上下文顺序（不是抽句子）
const PEOPLE = [
  {
    who: '开货车的，嘴上不饶人',
    lines: ['今天又堵在经十路上了', '你说这破路修的什么玩意', '我他妈在车上坐了三个钟头',
      '饿得前胸贴后背', '你他妈说句话啊', '算了不骂你了，我也累',
      '你帮我看看明天几点出门合适', '我明天还得拉一趟货去章丘',
      '这活干得真他妈憋屈', '不过挣的钱还行', '你说我是不是贱',
      '行了行了，不说了', '对了，你那个功能做出来没', '做出来给我说一声',
      '我先眯一会儿', '到了我叫你', '你他妈别催我',
      '哈哈开玩笑的', '你这人还挺好', '回头请你喝汽水'],
  },
  {
    who: '高三的，话少但情绪冲',
    lines: ['在吗', '烦', '今天考试又没考好', '我妈又要说我',
      '你别安慰我', '我不想听那些', '我就是想骂两句',
      '你说我是不是真不行', '算了', '我自己待会',
      '你别说了', '我知道你是好意', '但我现在不想听',
      '我这会儿有点想哭', '没事', '一会儿就好',
      '你还在吗', '在就行', '别回太多', '谢了'],
  },
  {
    who: '阴阳怪气型',
    lines: ['哟，又在呢', '你可真行啊', '这么点事弄半天',
      '我夸你呢，听不出来？', '哈哈你别当真', '不过说实话这活确实慢',
      '我要是不催你，你是不是能拖到明天', '你说说', '别解释',
      '解释就是掩饰', '行吧行吧', '我也不是不讲理的人',
      '你把那个做完了吗', '做完了给我看看', '没做完就别吹',
      '我这人说话直', '你别往心里去', '我这不就是为你好',
      '你他妈的还真是个人才', '哈哈，这句是夸'],
  },
  {
    who: '特别客气但客气得生硬',
    lines: ['您好，我想问一下这个功能怎么用', '谢谢您', '请问数据会丢吗',
      '好的，我明白了', '还有一个问题', '如果我要换电脑呢',
      '麻烦您了', '那我先试试', '好像不太行', '我再试一次',
      '还是不行，抱歉', '可能是我操作错了', '您能再说一遍吗',
      '好，这次可以了', '非常感谢', '那这个能导出吗',
      '明白了', '那我先不打扰您了', '有问题我再问', '谢谢'],
  },
  {
    who: '喝多了的',
    lines: ['兄弟', '我跟你讲', '我这人没啥本事', '但我不服',
      '你知道我当年多猛吗', '一百六十斤', '现在剩这点',
      '我他妈不服啊', '你说人活着图啥', '图个痛快',
      '你别劝我', '我没喝多', '就三杯', '真的三杯',
      '你说我是不是挺没用的', '不是', '我不是那意思',
      '算了，睡觉', '你别走', '在吗'],
  },
]

const problems = []
let rounds = 0
let wrongKey = 0
let noMoodLine = 0
let wrote = 0
let writeFail = 0
let recallFail = 0
let pageFail = 0

const GOOD_KEYS = new Set(['calm', 'joy', 'happy', 'tender', 'irritated', 'angry', 'hurt',
  'sad', 'weary', 'tired', 'low', 'numb', 'tense', 'dejected', 'lonely', 'anxious'])

for (const p of PEOPLE) {
  let turn = 0
  for (const line of p.lines) {
    turn++
    rounds++
    const sim = await get('/consciousness/sim?text=' + encodeURIComponent(line))
    let inj = ''
    let judge = null
    try { const j = JSON.parse(sim.body); inj = j.inject || ''; judge = j.judge } catch {}
    const moodLine = (inj.match(/【她这会儿】[^\n]*/) || [''])[0]
    if (!moodLine) { noMoodLine++; problems.push({ kind: '没有情绪行', who: p.who, line }) }
    // 只看页面上会不会出现"说不清"或英文——那才是用户能看见的问题
    if (moodLine && (/说不清/.test(moodLine) || /[a-zA-Z]{3,}/.test(moodLine))) {
      wrongKey++
      problems.push({ kind: '显示没名字', who: p.who, line, key: moodLine.slice(0, 40) })
    }

    // 每五轮写一条，看能不能搜回来、页面能不能看见
    if (turn % 5 === 0) {
      const title = p.who + '第' + turn + '句'
      const w = await T.addTool.execute({
        sea: SEA, title, text: '他说：' + line + '。我记得这句。', kind: 'fact', imp: 0.6,
      }, {})
      if (!w || !w.ok) { writeFail++; problems.push({ kind: '写不进', who: p.who, line }) } else {
        wrote++
        const q = await T.searchTool.execute({ sea: SEA, query: line.slice(0, 6), limit: 3, review: false }, {})
        const found = /第|他|记忆/.test(String(q && q.log))
        if (!found) { recallFail++; problems.push({ kind: '搜不回', who: p.who, line }) }
      }
    }
  }
}

// 页面里有没有写进去的东西
const page = await get('/consciousness?id=' + SEA)
const pageOk = page.status === 200 && page.body.includes('第5句')
if (!pageOk) { pageFail++; problems.push({ kind: '页面里没有', detail: 'HTTP ' + page.status }) }

try { if (existsSync(seaDir)) rmSync(seaDir, { recursive: true, force: true }) } catch {}

console.log('\n一百轮对话（5 人 × 20 句）')
console.log('  轮数', rounds, '｜写入', wrote, '条')
console.log('  没有情绪行', noMoodLine)
console.log('  没名字的情绪', wrongKey)
console.log('  写不进', writeFail, '｜搜不回', recallFail, '｜页面缺', pageFail)
console.log('  问题总数', problems.length)
for (const pr of problems.slice(0, 12)) console.log('   -', pr.kind, '｜', pr.who || '', '｜', String(pr.line || pr.detail || '').slice(0, 24), pr.key ? '(' + pr.key + ')' : '')
process.exit(problems.length ? 1 : 0)
