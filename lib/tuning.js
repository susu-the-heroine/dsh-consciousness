/**
 * 调参口 · tuning
 * ==============
 *
 * 排位那几个数字（向量门槛、标题加权、实体加权、同义词桥）不放死在代码里。
 * 读 ~/.dsh/consciousness-tuning.json，文件改了就生效，不用重启。
 *
 * 为什么要这么干：改一次数要重启一次、量一次要重启一次，一天重启十来回。
 * 参数放进文件，改文件立刻能量下一组数。
 *
 * 默认值 = 当前线上行为，文件不存在时就是它。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-tuning.json')

export const DEFAULTS = {
  vecMin: 0.4,      // 向量纳入门槛
  // 字面分的常见度加权：1 开、0 关。开着重惩罚「大肥鱼」这种到处都在的词。
  textIdf: 1,
  // 字面路的总系数：1 是现状，压到 0 就等于只用向量（实测纯向量在前三/头名都更好）。
  textW: 1,
  // 下面四个以前只写在代码里当兜底，DEFAULTS 里没有——调参文件看见的谱子跟实际不一样。
  // 2026-11-14 夜对齐：值照抄代码里的兜底，行为不变，只是让配置文件能看见它们。
  minScore: 0,
  relSlots: 3,
  relatedLift: 0,
  recallGapMin: 12,
  dupMin: 0.86,     // 写完跟旧记忆多像算"同一件事"（0-1）。别人的库密度不同，这个该能调
  titleBoost: 3,    // 标题字命中一次加多少
  entBoost: 5,      // 实体名出现在问句里加多少
  synonym: {},      // 同义词桥：{"死": ["葬礼","消失"]}
  // 2026-11-19 夜（P03）：下面四个原来散在检索逻辑里，一起搬进来，值一字不改。
  confHigh: 0.8,    // 置信度「高把握」下沿（头名相对分）
  confMid: 0.4,     // 「一般」下沿；再低就只算沾边
  valueWin: 24,     // 值闸窗口：问一个值，只在主体词前后这么多字里找
  gatePool: 40,     // 形状闸/实体闸看多少条候选
  // 2026-11-19 夜（P66/P67）：下面四个也是写死的，一起搬进来
  weakCov: 0.2,     // 弱信号：问句实词覆盖率低于它，就说「对得不准」
  weakHit: 60,      // 弱信号：头名命中分低于它，也算弱
  divMax: 3,        // 同一主题最多留几条（多样性）
  divTh: 0.6,       // 多相似算「同一主题」
  // 2026-11-20 夜：问「最新/现在/最高」这类时，近期条目加权多少
  freshBoost: 0.25,
  freshDays: 7,     // 以一周为尺度：越近越接近满额
  // 2026-11-22 凌晨：回看那条闭环原来写死「连着两次才提醒」，中间会漏。
  // 现在两次都进配置：多少分算有腔、连着几次触发重说。
  replyBadScore: 0.35,
  retryStreak: 1,
  // 2026-11-22：短句分（shortvoice）校准结果不行——他自己的短句 100 条里 82 条落在 0.18 以下，
  // 这时它已经不是"不像她"，是"这条尺子不认她"。默认关掉，留着开关做实验。
  shortBadOn: 0,
  // 2026-11-22：风格采集默认关。第一版把海写卡死过一次（raw 171MB 全读 + 逐条重写 241MB 海）。
  // 想开：consciousness-tuning.json 里写 {"styleOn": 1}。
  styleOn: 0,
  shortBadScore: 0.18,
}

let _cache = null
let _at = 0

export function tuning() {
  try {
    if (!existsSync(FILE)) return DEFAULTS
    const mt = statSync(FILE).mtimeMs
    if (_cache && mt === _at) return _cache
    const j = JSON.parse(readFileSync(FILE, 'utf8'))
    _cache = { ...DEFAULTS, ...(j && typeof j === 'object' ? j : {}) }
    _at = mt
    return _cache
  } catch {
    return DEFAULTS
  }
}

/** 把问句的词按同义词桥扩一圈：返回额外要参与匹配的词 */
export function expandTerms(query) {
  const t = tuning()
  const out = []
  const syn = t.synonym && typeof t.synonym === 'object' ? t.synonym : {}
  for (const [k, arr] of Object.entries(syn)) {
    if (!k || !query.includes(k)) continue
    for (const v of (Array.isArray(arr) ? arr : [])) {
      const w = String(v || '').trim()
      if (w) out.push(w)
    }
  }
  return out
}
