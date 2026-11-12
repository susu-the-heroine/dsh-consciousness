/**
 * 情绪运行时
 * ==========
 *
 * emotion.js 是「怎么算」，这里是「怎么活」：
 *   readHeart  —— 读心跳（能量、疲惫、情绪 mix）
 *   writeHeart —— 写回去
 *   tickHeart  —— 按时间结算：回能量、退疲惫
 *   applyMood  —— 把新情绪叠进 mix，算主调、PAD、一句话
 *   defaultMood—— 兜底，缺字段就补默认值
 *   judgeEmotion — 一句话判成情绪（用 cheapAppraise 的兜底规则）
 *
 * 注意：老的「六状态」接口全留着（MOODS / MOOD_LABEL / EMO_TO_MOOD），
 * 球上那五个器官还认 mood，别把老的拆了。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { HEART_FILE } from './paths.js'
import {
  EMOTIONS, feel, decayMix, dominant, padOf, octantOf, cheapAppraise,
  emptyState, say, pairOf, describe, tierOf, CALIBRATION,
} from '../assets/emotion.js'

/** 心脏状态：能量、疲惫。没文件就新建一个满的。 */
export function readHeart() {
  try {
    const j = JSON.parse(readFileSync(HEART_FILE, 'utf8').replace(/^\uFEFF/, ''))
    return {
      energy: Number.isFinite(j.energy) ? Math.max(0, Math.min(1, j.energy)) : 1,
      fatigue: Number.isFinite(j.fatigue) ? Math.max(0, Math.min(1, j.fatigue)) : 0,
      updated: Number(j.updated) || Date.now(),
      lastThought: j.lastThought && j.lastThought.title ? j.lastThought : null,
      thoughts: Array.isArray(j.thoughts) ? j.thoughts.slice(0, 30) : [],
      intake: (j.intake && typeof j.intake === 'object') ? j.intake : null,
      lastAdd: Number(j.lastAdd) || 0,

      // 情绪这五样之前被这里丢掉了 —— 于是每次推情绪都从空开始叠，
      // 上一条的情绪永远留不住，heart 文件里写了也读不回来。
      mix: (j.mix && typeof j.mix === 'object' && !Array.isArray(j.mix)) ? j.mix : {},
      mixAt: Number(j.mixAt) || 0,
      grudge: Number(j.grudge) || 0,
      mood: typeof j.mood === 'string' ? j.mood : 'calm',
      moodStrength: Number(j.moodStrength) || 0.3,
      moodSince: Number(j.moodSince) || 0,
      moodText: typeof j.moodText === 'string' ? j.moodText : '',
      moodPair: typeof j.moodPair === 'string' ? j.moodPair : '',
      // 自心模式的三样：八维快照、"被勾住"的线索、记录时间。
      // 白名单这毛病栽过两次了——以后新增字段记得在这儿补一行。
      dims: (j.dims && typeof j.dims === 'object' && !Array.isArray(j.dims)) ? j.dims : null,
      dimsAt: Number(j.dimsAt) || 0,
      beingDrawn: (j.beingDrawn && typeof j.beingDrawn === 'object') ? j.beingDrawn : null,
      damp: Number.isFinite(j.damp) ? j.damp : null,
      dampText: typeof j.dampText === 'string' ? j.dampText : '',
      absence: (j.absence && typeof j.absence === 'object') ? j.absence : null,
      pad: (j.pad && typeof j.pad === 'object') ? j.pad : null,
      octant: typeof j.octant === 'string' ? j.octant : '',
    }
  } catch {
    return {
      energy: 1, fatigue: 0, updated: Date.now(),
      mix: {}, mixAt: 0, grudge: 0,
      mood: 'calm', moodStrength: 0.3, moodSince: 0,
      moodText: '', moodPair: '', pad: null, octant: '',
    }
  }
}

/* ---------- 情绪状态机 ----------
 * 她有自己的心情，不是一个回合一个回合重新算的。
 * 六个状态，会变、会衰减、会抵抗。
 * 风险文档：「情绪状态机数值溢出；会话休眠后台持续衰减」→ 数值截断 + 闲置冻结。
 */
export const MOODS = ['calm', 'happy', 'low', 'irritated', 'tired', 'holding']

export const MOOD_LABEL = {
  calm: '平静',
  happy: '高兴',
  low: '低落',
  irritated: '烦躁',
  tired: '累',
  holding: '绷着',
}

/**
 * 31 种情绪 → 六个老状态。
 * 为什么要映射：球上那五个器官、心跳条、右栏的颜色都还认 mood。
 * 不破坏老接口，把新的叠上去。
 */
export const EMO_TO_MOOD = {
  fierce: 'irritated', angry: 'irritated', disdain: 'irritated', jealous: 'irritated', disgusted: 'irritated',
  hurt: 'low', sad: 'low', lonely: 'low', dejected: 'low', guilty: 'low',
  ashamed: 'low', numb: 'low', drained: 'low', bored: 'low',
  tired: 'tired',
  anxious: 'holding', nervous: 'holding', scared: 'holding', worried: 'holding', tense: 'holding',
  impatient: 'irritated', restless: 'irritated',
  joy: 'happy', happy: 'happy', moved: 'happy', eager: 'happy', curious: 'happy',
  proud: 'happy', shy: 'happy', soft: 'happy', calm: 'calm', fond: 'happy',
}

/** 情绪判断：规则 + 轻量，不调模型。
 *  先判情绪，再听内容——人先感觉，工具先分析。 */
export function judgeEmotion(text, hour) {
  text = sanitizeDeath(text)
  const s = String(text || '')
  const h = Number.isFinite(hour) ? hour : new Date().getHours()

  // 31 种情绪里挑最像的那条（emotion.js 的兜底评价，不需要模型）
  const ap = cheapAppraise(s)

  // 纯天气句不点燃（2026-11-08 实测：「今天天气不错」被判高兴 48%，等于一句闲聊翻了方向）。
  // 验收表第二组要求：闲聊不该大动，最多挪一点。
  if (/天气(不错|挺好|真好|可以)/.test(s) && s.length < 12) {
    return { mood: 'calm', emoKey: 'flat', intensity: 0.08, confidence: 0.5, dims: {} }
  }

  // 口语覆盖层。
  // 词表是按书面语建的，人嘴里说的话不在表里——
  // 实测：气死我了 / 想哭 / 吓死我了 / 真开心 / 火大 / 委屈 / 憋屈 / 崩溃
  // 全被判成 calm 0，等于她听不见这些话。这层专治这个。
  const COLLOQUIAL = [
    [/气死|气炸|火大|来气|冒火|气得/, 'angry', 0.7],
    [/想哭|要哭|哭出来|鼻子酸|眼睛涩/, 'sad', 0.6],
    [/吓死|吓人|发毛|后怕|心惊/, 'scared', 0.65],
    [/真开心|好开心|高兴坏|乐死|太爽|舒服死/, 'joy', 0.65],
    [/委屈|憋屈|窝火|冤得|心里堵/, 'sad', 0.55],
    [/崩溃|顶不住|受不了|扛不住|撑不下去/, 'dejected', 0.6],
    [/不舒服|不得劲|难受得|浑身难受/, 'sad', 0.45],
    [/烦(死|了死|得慌)|烦透|烦人|恶心/, 'angry', 0.5],
    // 「我不想干了」「不干了」是最常见的撑不住，不是平静。
    // 2026-11-08 实测：这句判 calm 0，注入里「他不好受，别讲道理」整块消失，
    // 她于是拿"哪个环节最难受"去追细节——不是她不会安慰，是系统没告诉她该安慰。
    [/不想干了?|不想弄了?|干不下去|做不下去|不想做|撂挑子|说撂就撂|收摊不干/, 'dejected', 0.58],
    [/真行啊|可真厉害|可真是行|厉害了[^a-z]/, 'irritated', 0.5],
    [/每次都这样|从来都这样|总是这样|每次都是|每次都|从来(都)?不|从来(都)?没|老是/, 'angry', 0.45],
  ]
  for (const [re, k, v] of COLLOQUIAL) {
    if (!re.test(s)) continue
    // 只在原判定没抓到东西时才覆盖，别把已经判准的压掉
    if (ap.key === 'calm' || !(Number(ap.intensity) > 0.2)) {
      return {
        mood: EMO_TO_MOOD[k] || 'calm',
        emoKey: k,
        intensity: v,
        confidence: 0.6,
        dims: ap.dims || {},
      }
    }
  }

  let key = ap.key
  let intensity = ap.intensity
  let confidence = 0.55

  // 短句 + 深夜 + 没标点 = 绷着。这条是经验，但不能乱套。
  // 「重启了」「继续」「好了」是操作陈述，不是情绪。判成绷着就假了。
  const OPERATIONAL = /^(重启|继续|好了|可以|行|嗯|哦|对|是|ok|OK|收到|明白|知道|完成|done|开始|停了|好了|试试|测一下)/i
  // 两个字的应答：「没有」「是」「不是」「对」——这是回答，不是情绪。
  // 之前它们被「短句+深夜=绷着」那条规则吃进去，一路堆到 98%。
  const SHORT_ACK = /^(有|没有|是|不是|对|不对|好|不好|行|不行|嗯|哦|啊|哈|可以|不可以|知道了|收到|明白|懂|没有啊|也就|还行)$/
  const isOperational = OPERATIONAL.test(s.trim()) || SHORT_ACK.test(s.trim())
  if (isOperational) {
    // 操作陈述：不带情绪。「重启了」就是重启了，不该被读成「有点满足」。
    return { mood: 'calm', emoKey: 'calm', intensity: 0, confidence: 0.9, dims: {} }
  }
  if (s.length > 0 && s.length < 8 && h >= 1 && h <= 4 && !/[！!]/.test(s)) {
    if (key === 'calm') { key = 'tense'; intensity = 0.42 }   // 0.6 太高，两轮就顶
  }

  // 省略号多 = 犹豫
  const ell = (s.match(/……|\.\.\./g) || []).length
  if (ell >= 2) intensity = Math.min(1, intensity + 0.15)

  return { mood: EMO_TO_MOOD[key] || 'calm', emoKey: key, intensity, confidence, dims: ap.dims }
}

export const MOOD_TONE = {
  calm: 0, happy: 0.6, low: -0.7,
  irritated: -0.5, tired: -0.4, holding: -0.3,
}

/** 推进情绪。她的心情不会因为你一句话就变，要走几个回合。 */
/**
 * 推进情绪。
 *
 * 旧版是「六状态机」：一次只能是一种，强的一方吃掉弱的一方。
 * 新版是 mix：31 种并行，各自半衰，相克互吃，相近互喂。
 * h.mood 还留着（球上五个器官认它），由 mix 里最强的那条映射回来。
 */
export function applyMood(h, judged) {
  if (!judged) return h

  // 1) 先让旧的退一退（按时间）
  const _at0 = Number(h.mixAt) || Date.now()   // 先记住原来的时间，decayMix 会把它刷成现在
  const st = { mix: h.mix || {}, grudge: Number(h.grudge) || 0, at: _at0 }
  decayMix(st, Date.now())

  // 怨气也得随时间自己消。
  // 今晚实测：只攒不消，攒到 94% 就永远挂着——那不像人，像记账本。
  // 半衰期十二个钟头：隔一夜，气消一半；没人哄也能过去。
  try {
    const _gone = Math.max(0, Date.now() - _at0)
    if (_gone > 60000 && st.grudge > 0) {
      st.grudge = st.grudge * Math.exp(-_gone / (12 * 3600 * 1000))
      // 强度为 0 的时候下面会提前 return，所以这里先写回心脏，
      // 不然算出来的衰减白算。
      h.grudge = st.grudge
      h.mixAt = st.at
    }
  } catch {}

  // 2) 再把新的叠上去
  const key = judged.emoKey || 'calm'
  const inten = Math.max(0, Math.min(1, judged.intensity || 0))
  // 强度 0 = 中性陈述，不产生任何情绪，也不写盘
  if (inten <= 0.001) return h
  // 她的情绪有惯性：刚被带起来的时候，新的一下打不了满分
  const inertia = 0.55 + 0.45 * (1 - (Number(h.moodStrength) || 0.3))
  feel(st, key, inten * inertia, { now: Date.now() })

  /* 怨气累积
   * 原来这里只看 judged.grudge —— 那是模型判定时才有的字段。
   * 而兜底的 cheapAppraise 从来不返回它，所以 grudge 永远是 0，
   * CALIBRATION 里 grudgeUp / grudgeDown 两条常数白写。
   *
   * 现在从效价推：负性事件攒，正性事件消，强度越大动得越多。
   * 不对称是故意的：攒起来容易，消下去要靠好事。
   */
  // 只有「记仇型」的情绪攒怨气。累了、麻木了不算——那是状态，不是过节。
  const GRUDGE_KINDS = new Set(['angry', 'hurt', 'stung', 'sour', 'jealous', 'disdain', 'fierce'])
  const val = Number(judged && judged.dims && judged.dims.conduciveness)
  if (Number.isFinite(val) && inten > 0.15) {
    // 骂活、纠错、催进度，不算结仇。
    // 只有骂人（废物/滚/傻…）、或者真把他伤到了，才往怨气里记。
    const _said = String((judged && judged.text) || '')
    const _personal = /废物|垃圾|滚|傻|没救|蠢|闭嘴|去死|丢人|你就这|你他妈就是/.test(_said)
    if (GRUDGE_KINDS.has(key) && (_personal || key === 'hurt')) {
      st.grudge = Math.min(1, st.grudge + CALIBRATION.grudgeUp * inten)
    } else if (val > 0.2) {
      // 好事消怨气：不用挑种类，只要它是好事
      st.grudge = Math.max(0, st.grudge - CALIBRATION.grudgeDown * inten)
    }
  }

  h.mix = st.mix
  h.grudge = st.grudge
  h.mixAt = st.at

  // 3) 映射回六状态（给老接口用）
  const dom = dominant(st)
  h.mood = EMO_TO_MOOD[dom.key] || 'calm'
  h.moodStrength = Math.max(0.05, Math.min(1, dom.strength))
  if (!h.moodSince) h.moodSince = Date.now()

  // 4) 顺带把 PAD 也存下来，界面上能画
  const pad = padOf(st)
  h.pad = pad
  h.octant = octantOf(pad)

  // 5) 一句人话。「又气又舍不得」比「angry 0.6」有用得多。
  try {
    h.moodText = describe(st)
    const p2 = pairOf(st)
    h.moodPair = p2 ? p2.label : ''
  } catch {
    h.moodText = MOOD_LABEL[h.mood] || '平静'
  }

  return h
}

/** 按过了多少时间结算：能量慢慢回来，太累的时候疲惫也慢慢退 */
export function defaultMood(h) {
  if (!h) return h
  if (!h.mood || !MOODS.includes(h.mood)) h.mood = 'calm'
  if (!Number.isFinite(h.moodStrength)) h.moodStrength = 0.3
  if (!h.moodSince) h.moodSince = Date.now()
  // 51 种情绪的容器
  if (!h.mix || typeof h.mix !== 'object') h.mix = {}
  if (!Number.isFinite(h.mixAt)) h.mixAt = Date.now()
  if (!Number.isFinite(h.grudge)) h.grudge = 0
  // 一句人话（没被推过也有）
  if (!h.moodText) {
    try {
      h.moodText = describe({ mix: h.mix, grudge: h.grudge, at: h.mixAt })
    } catch {
      h.moodText = MOOD_LABEL[h.mood] || '平静'
    }
  }
  return h
}

export function tickHeart(h, idleSec) {
  const now = Date.now()
  const mins = Math.max(0, (now - (h.updated || now)) / 60000)
  if (mins <= 0) return h
  // 闲着回得快，有人在动就回得慢——像真的在休息
  let pace = 1
  if (Number.isFinite(idleSec)) {
    if (idleSec > 300) pace = 1.7        // 五分钟没人：躺着回
    else if (idleSec > 30) pace = 1.0    // 刚离开
    else pace = 0.35                     // 正在被看着：先不动
  }
  // 原来 rec 0.0004 / burn 0.00055：净支出，写十几条记忆就永久 0 电，
  // 再也回不来——她从此一直"累瘫"，检索永久缩水。
  // 2026-11-08 实测到 energy = -0.00001，才发现的。
  const rec = mins * 0.0024 * pace               // 闲着五小时能睡满
  const burn = mins * 0.0004                     // 活着就在耗
  h.energy = Math.min(1, h.energy + rec - burn)
  // 能量低的时候疲惫涨得慢，恢复了才退
  if (h.energy < 0.35) h.fatigue = Math.min(1, h.fatigue + mins * 0.0008)
  else h.fatigue = Math.max(0, h.fatigue - mins * 0.0005)
  // 情绪：时间会让它退回去。
  // 但羞耻和麻木不退——那两种越久越深，是风险文档明写的
  // 绷着不是永远不退：文档《运行规则》写的是半天一半（半衰期一天）。
  // 以前这里写死"永不退"，跟文档对着干，实测卡在 41% 一整天。
  const heldH = (now - (h.moodSince || now)) / 3600000
  const noHeal = (h.mood === 'holding' && heldH < 24)
  if (h.mood && h.mood !== 'calm' && !noHeal && Number.isFinite(h.moodStrength)) {
    // 闲置超过两小时就冻结，不后台一直算（风险文档要求）
    // 以前这里看的是「这个情绪多久以前开始的」，不是「多久没动」。
    // 结果任何情绪只要满两小时就被判成"闲置"，冻死，永远不退——
    // 实测绷着卡在 41% 一整天，就是它。
    const idle = (now - (h.updated || now)) / 60000
    if (idle < 120) {
      h.moodStrength = Math.max(0, Math.min(1, h.moodStrength))
      // 每轮退一点，不是按时间——按时间会退太快
      h.moodStrength = h.moodStrength - mins * 0.0006
      if (h.moodStrength <= 0.12) {
        h.mood = 'calm'
        h.moodStrength = 0.3
        h.moodSince = now
      }
    }
  }

  // 一致性：情绪表空了，那句话说的事也就不存在了。
  // 实测出现过 moodText="委屈死了" 而 mix={} —— 页面上说她委屈，底下是空的。
  const _mixKeys = Object.keys(h.mix || {}).filter((k) => (Number(h.mix[k]) || 0) > 0.02)
  if (!_mixKeys.length) {
    h.mood = 'calm'
    h.moodStrength = 0.3
    if (!h.moodText || h.moodText === '委屈死了') h.moodText = '没什么起伏'
  }

  h.updated = now
  return h
}

export function writeHeart(h) {
  try {
    writeFileSync(HEART_FILE, JSON.stringify(h), 'utf8')
  } catch {
    /* 心脏状态写不进去不影响别的 */
  }
}

/**
 * 「死一段」「笑死」「累死」「死机」都不是死。
 * 实测：他剪视频说「死一段」，她被触发成"怕得要死 85%"。
 */
export function sanitizeDeath(text) {
  return String(text || '')
    .replace(/死一段|死一截|死机|笑死|累死|热死|忙死|困死|饿死|死磕|死线/g, '…')
}
