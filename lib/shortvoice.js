/**
 * 短句的尺子
 * =========
 * 现成的 humanness 量的是"具体物密度"，短句天生吃亏：
 * 他的短句 0.617、剧本 0.579、弹幕 0.596——三个来源全挤在一起，分不开。
 *
 * 短句该量的是三件事：
 *   1. 有没有一个动作（动词）
 *   2. 有没有一个态度（否定/反问/命令/骂）
 *   3. 是不是人说话的口气（语气词、短停顿、不完整句）
 *
 * 高分的样子： 「还没好？」「你他妈卡死了」「我明天中午在学校啊」
 * 低分的样子： 「时光荏苒，岁月如梭」「这一切都值得被铭记」
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { scoreWith, feats } from './shortvoice-model.js'

const WEIGHTS_FILE = () => join(homedir(), '.dsh', 'consciousness-shortvoice.json')

const ACTIONS = /走|来|去|吃|睡|坐|站|跑|拿|放|看|听|说|问|答|做|弄|写|改|删|装|卸|买|卖|给|要|拿|扔|捡|骂|哭|笑|怕|累|疼|等|开|关|点|发|录|剪|拍|充|连|断|卡|崩|挂|修|试|干/
const ATTITUDE = /不|别|没|甭|谁|啥|怎么|这么|那么|才|就|还|也|都|他妈|他吗|草|靠|卧槽|滚|闭嘴|行了|够了|算了|凭什么|凭什么|非要|必须|偏|敢/
const SPEECHY = /啊|吧|呢|嘛|呗|么|唉|嘿|哈|呀|哦|喔|咯|啦|嘞|呐|嗯|诶|哎|得|了$/
const BOOKISH = /岁月|时光|人生|灵魂|宿命|永恒|汹涌|缱绻|氤氲|斑驳|仿佛|宛若|亦|皆|乃|致使|从而|值得被/

/** 短句分：0~1。越像"人张嘴说的一句话"越高 */
export function shortVoice(text) {
  const t = String(text || '').trim()
  const n = [...t].length
  if (!n) return { score: 0, parts: {}, len: 0 }

  const hasAction = ACTIONS.test(t)
  const hasAttitude = ATTITUDE.test(t)
  const speechy = SPEECHY.test(t)
  // 口语长度：3~22 字最像一句话；太短没信息，太长就成叙述了
  let lenFit = 1
  if (n < 3) lenFit = 0.4
  else if (n > 26) lenFit = Math.max(0.2, 1 - (n - 26) / 40)

  const bookish = BOOKISH.test(t)
  // 问号/感叹号是态度
  const punct = /[？！!?]/.test(t) ? 1 : 0

  const parts = {
    动作: hasAction ? 1 : 0,
    态度: (hasAttitude ? 0.6 : 0) + punct * 0.4,
    口气: speechy ? 1 : 0,
    长度: lenFit,
    书卷: bookish ? 0 : 1,
  }
  const ruleScore = (
    parts.动作 * 0.26 +
    parts.态度 * 0.30 +
    parts.口气 * 0.16 +
    parts.长度 * 0.16 +
    parts.书卷 * 0.12
  )
  // 有学出来的权重就用学的（AUC 0.665），没有再退回规则分。
  // 规则分解释得清、学出来的分得开，两者都留着，谁也别冒充谁。
  let learned = null
  try {
    const w = loadWeights()
    if (w) learned = scoreWith(w, t)
  } catch {}
  let score = learned == null ? ruleScore : learned
  // 「你可以…」「建议你…」这类 AI 腔单独扣分：实测它是鳞尺子认不出的那类话。
  const polite = /你可以|建议你|如果你|希望对你有|随时告诉我|供你参考|不妨|可以考虑/.test(t)
  if (polite) score = Math.max(0, score - 0.15)
  return { score: Math.max(0, Math.min(1, score)), parts, len: n, learned, polite }
}

let _wCache
let _wAt = 0
function loadWeights() {
  try {
    const p = WEIGHTS_FILE()
    if (!existsSync(p)) return null
    // 一分钟缓存，别每句话都读盘
    if (_wCache && Date.now() - _wAt < 60000) return _wCache
    const j = JSON.parse(readFileSync(p, 'utf8'))
    // 训练脚本落盘的是 {weights, posMean, negMean, n, at}，权重在里面那层
    _wCache = j && j.weights && typeof j.weights === 'object' ? j.weights : (j && typeof j === 'object' ? j : null)
    _wAt = Date.now()
    return _wCache
  } catch { return null }
}
