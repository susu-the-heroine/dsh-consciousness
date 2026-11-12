/**
 * AI 味尺子
 * =========
 * 苏苏侠要的是「全人」。全人的反面不是"不够像人"，是有腔。
 *
 * 这把尺子只抓腔，不评好坏：
 *   定义腔    "X 是 A 的 B，不是 C"、"所谓"、"本质上"
 *   列举腔    "首先/其次/第三/综上"
 *   总结腔    "一句话""总的来说""核心在于"
 *   解释腔    "也就是说""换句话说""这意味着"
 *   空话腔    "需要指出的是""值得注意的是""不难看出"
 *   排比腔    一句里三四个"、"并列
 *   元话语    "我上面说的""下面我讲"
 *
 * 分越高越有腔。0.3 以下基本没有。
 * 用法：import { aiflavor } from './aiflavor.js'
 */
const RULES = [
  { name: '定义腔', re: /(?:所谓|本质上|实质上|是[^，。]{2,14}的[^，。]{0,10}不是)/g, w: 0.22 },
  { name: '列举腔', re: /(?:首先|其次|再次|第三点|最后一点|综上|总而言之)/g, w: 0.2 },
  { name: '总结腔', re: /(?:总的来说|一句话[，,]|核心在于|关键在于|归根结底)/g, w: 0.18 },
  { name: '解释腔', re: /(?:也就是说|换句话说|这意味着|换言之)/g, w: 0.18 },
  { name: '空话腔', re: /(?:需要指出的是|值得注意的是|不难看出|可以说[，,])/g, w: 0.2 },
  { name: '元话语', re: /(?:我上面说的|下面我(?:讲|说)|如前所述|这一点很重要)/g, w: 0.16 },
  // 明面上的腔好抓，暗的才是真功夫：判断句、冒号断言、"不是……是……"
  { name: '判断腔', re: /(?:不是[^，。！？]{2,18}[，,]?\s*是|是[^，。！？]{2,18}的[^，。！？]{0,6}不是)/g, w: 0.18 },
  { name: '冒号断言', re: /：[^「“"][^，。！？\n]{6,40}[。！？]/g, w: 0.14 },
  { name: '定性腔', re: /(?:得说死|说白了|归根到底|本质上是|这就是)/g, w: 0.16 },
]

/** 空转：没有动作、没有具体东西，却又说了一整句 */
const ACTION = /走|来|去|吃|睡|坐|站|跑|拿|放|看|听|说|问|答|做|弄|写|改|删|装|买|卖|给|要|扔|捡|骂|哭|笑|怕|累|疼|等|开|关|点|发|录|剪|拍|充|连|断|卡|崩|挂|修|试|干|翻|摁|敲|盯|憋|噎|读|念|记|忘|想|算|数|喊|叫|碰|摸|抱|推|拉|睡|醒|熬|喝|抽|咽|吐/
// 必须"数字/量词组合"或具体物件，单个「个/条/一」太常见，不算
const THING = /[0-9０-９]+\s*[个条页块张包杯瓶根台部句字行秒分时天楼路街店桌窗门车]|[一两三四五六七八九十百千万]+\s*[个条页块张包杯瓶根台部句字行秒分时天楼路街店桌窗门车]|手机|键盘|鼠标|屏幕|香烟|酒|茶|饭|锅|椅子|床|墙|薯片|车|球|歌|电影|视频/
function idleTail(t) {
  const hits = []
  for (const s of String(t || '').split(/[。！？!?\n]/)) {
    const line = s.trim()
    if ([...line].length < 12) continue
    if (ACTION.test(line) || THING.test(line)) continue
    hits.push({ name: '空转腔', text: line.slice(0, 40) })
  }
  return hits
}

/** 一句里三四个顿号并列，也是腔 */
function parallelHits(t) {
  const hits = []
  const parts = String(t || '').split(/[。！？!?\n]/)
  for (const s of parts) {
    const n = (s.match(/、/g) || []).length
    if (n >= 3) hits.push({ name: '排比腔', text: s.trim().slice(0, 40), w: 0.14 })
  }
  return hits
}

/** 返回 { score, hits: [{name, text}] }，score 0~1，越高越有腔 */
export function aiflavor(text) {
  const t = String(text || '')
  const hits = []
  let raw = 0
  for (const r of RULES) {
    for (const m of t.matchAll(r.re)) {
      hits.push({ name: r.name, text: m[0] })
      raw += r.w
    }
  }
  for (const h of parallelHits(t)) {
    hits.push({ name: h.name, text: h.text })
    raw += h.w
  }
  for (const h of idleTail(t)) {
    hits.push({ name: h.name, text: h.text })
    raw += 0.12
  }
  // 同一腔最多计三次，别让一篇文章被一个词刷满
  const byName = {}
  for (const h of hits) byName[h.name] = (byName[h.name] || 0) + 1
  let capped = 0
  for (const [, c] of Object.entries(byName)) capped += Math.min(3, c)
  const score = Math.min(1, capped * 0.12)
  return { score: Number(score.toFixed(2)), hits, kinds: Object.keys(byName) }
}

/** 一句话版本，方便日志 */
export function flavorLine(text) {
  const r = aiflavor(text)
  if (!r.hits.length) return '没腔'
  return r.score + ' · ' + r.kinds.join('/')
}
