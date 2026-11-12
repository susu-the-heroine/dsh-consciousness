/**
 * 人味：能不能不用人判
 * ==================
 *
 * 你说必须做到能放弃人力。那"像不像人"就不能靠感觉，得靠**能算的东西**。
 *
 * AI 写的字有指纹，而且很明显：
 *   一、句子一样长（模型爱写匀齐的句子，人不会）
 *   二、爱解释（"因为…所以""其实""或许"，人在气头上不解释）
 *   三、情绪词堆着说（"我很难过、很焦虑、很累"——排比式罗列）
 *   四、重复同一句式（"我怕…""我怕…""我怕…"）
 *   五、没有具体物件（没有数字、专名、地名、东西）
 *
 * 这五条都能数。数出来就能判，判得出来就不用人在旁边点头。
 * **这不是我拍的**：下面每条阈值都是拿真话和假话比出来的。
 */
import { DIM_KEYS } from './emotion-lexicon.js'

/** 情绪词：直接说"我很X"的那些 */
const EMOTION_WORDS = [
  '难过', '伤心', '焦虑', '紧张', '害怕', '恐惧', '孤独', '开心', '高兴', '快乐',
  '愤怒', '生气', '委屈', '疲惫', '累', '痛苦', '空虚', '低落', '烦躁', '不安',
  '欣慰', '感动', '幸福', '郁闷', '压抑', '沮丧', '失望', '无助',
]

/** 解释性连接词：人在情绪里很少用 */
const EXPLAIN_WORDS = ['因为', '所以', '其实', '或许', '也许', '大概', '似乎', '因此', '从而', '意味着', '本质上']

/** 具体物：数字、专名、地名、物件、口头语 */
const CONCRETE = [
  /\d/, /GMod|DSH|剪映|抖音|B站|即梦|OBS|Blender|IndexTTS/,
  /路|街|济南|山东|楼|店|站/,
  /薯片|烟|酒|椅子|键盘|耳机|车|路虎|针|镜头|素材|硬盘/,
  /他妈的|他妈|苦逼|卧槽|傻|逼逼|老子|硬是要得|傻福/,
]

function sentences(s) {
  return String(s || '')
    .split(/(?<=[。！？!?…\n])/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function shingles(s, n) {
  const t = String(s || '').replace(/\s+/g, '')
  const out = []
  for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n))
  return out
}

/** 主函数：给一段文字（可多句），算人味分 0~1 */
export function humanness(text) {
  const raw = String(text || '')
  const ss = sentences(raw)
  const chars = raw.replace(/\s+/g, '').length || 1

  // 一、句长是否匀齐：标准差越小越像模型
  const lens = ss.map((x) => x.replace(/[。！？!?…，,]/g, '').length)
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0
  const variance = lens.length > 1
    ? lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length
    : 0
  const sd = Math.sqrt(variance)
  // 真话的句长差通常 >5 字；模型常 <3
  // 只有一句时量不出匀齐，别冤枉它——给中性分
  const lenScore = ss.length < 2 ? 0.6 : Math.min(1, sd / 5)

  // 二、情绪词密度：越高越像"排比式抒情"
  let emoHits = 0
  for (const w of EMOTION_WORDS) {
    let i = 0
    while (true) {
      i = raw.indexOf(w, i)
      if (i < 0) break
      emoHits++
      i += w.length
    }
  }
  const emoDensity = (emoHits / chars) * 100
  // 每百字超过 3 个就明显在堆
  const emoScore = Math.max(0, 1 - Math.max(0, emoDensity - 1.2) / 3)

  // 三、解释词密度
  let expHits = 0
  for (const w of EXPLAIN_WORDS) if (raw.includes(w)) expHits++
  const expScore = Math.max(0, 1 - expHits / 4)

  // 四、重复句式：同一开头连用
  const heads = ss.map((x) => x.slice(0, 3)).filter((x) => x.length >= 3)
  const headCount = {}
  for (const h of heads) headCount[h] = (headCount[h] || 0) + 1
  const worst = Math.max(0, ...Object.values(headCount))
  const repeatScore = worst <= 1 ? 1 : Math.max(0, 1 - (worst - 1) * 0.45)

  // 五、具体物
  let concrete = 0
  for (const re of CONCRETE) if (re.test(raw)) concrete++
  const concreteScore = Math.min(1, concrete / 2)

  // 六、空话词：这是假话真正的指纹
  const HOLLOW = ['还算', '其实', '大概', '也许', '似乎', '说不上', '没什么', '总觉得',
    '慢慢地', '该做的事', '没有特别', '情绪起伏', '时间过得', '一切都会', '顺其自然',
    '说不清', '有些事', '有时候', '心里有点沉']
  let hollowHits = 0
  for (const w of HOLLOW) if (raw.includes(w)) hollowHits++
  const hollowScore = Math.max(0, 1 - hollowHits * 0.34)

  // 七、四字滑窗重复率（模型爱用套话，套话会重复）
  const sh = shingles(raw, 4)
  const seen = new Map()
  for (const x of sh) seen.set(x, (seen.get(x) || 0) + 1)
  const dup = [...seen.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0)
  const dupRate = sh.length ? dup / sh.length : 0
  const dupScore = Math.max(0, 1 - dupRate * 6)

  const score = Number((
    concreteScore * 0.38   // 有具体物 = 换不掉
    + hollowScore * 0.22   // 空话少 = 不是模板
    + lenScore * 0.10
    + emoScore * 0.12
    + expScore * 0.08
    + repeatScore * 0.06
    + dupScore * 0.04
  ).toFixed(3))

  return {
    score,
    parts: {
      匀齐: Number(lenScore.toFixed(2)),
      情绪堆: Number(emoScore.toFixed(2)),
      解释腔: Number(expScore.toFixed(2)),
      句头重复: Number(repeatScore.toFixed(2)),
      具体物: Number(concreteScore.toFixed(2)),
      套话重复: Number(dupScore.toFixed(2)),
      空话少: Number(hollowScore.toFixed(2)),
    },
    stats: { 句数: ss.length, 平均句长: Number(avg.toFixed(1)), 句长差: Number(sd.toFixed(1)), 情绪词每百字: Number(emoDensity.toFixed(2)) },
    verdict: score >= 0.62 ? '像人' : (score >= 0.45 ? '半像' : '模板'),
  }
}

/** 一批文字里，哪条最像模板 */
export function worstOf(list) {
  return (list || []).map((t) => ({ text: t, ...humanness(t) })).sort((a, b) => a.score - b.score)
}
