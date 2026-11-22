/**
 * 第三层：真的想一句
 * ================
 *
 * 边界先说清：**插件里没有模型 API**。所以这里做的是"除最后那一次调用以外的全部"：
 *
 *   一、判断这会儿该不该想（档位、当日额度、token 预算、熔断）
 *   二、挑一条线索（加权抽样，不是纯随机）
 *   三、把那句 prompt 拼好
 *   四、拿到结果后写进私有池、记花费、必要时熔断
 *
 * 宿主只要把 `prompt` 递给模型，把返回的句子交给 `finishThink()`。
 * 这样它就不是"没做"，而是"只缺一次调用"。
 */
import { canThink, noteThink, readMode, reserveThink, releaseThink } from './selfmode.js'
import { pickForRecall, addThought, touchThought } from './selfmind.js'
import { checkVoice } from './voicecheck.js'
import { humanness } from './humanness.js'
import { DIM_KEYS, DIMS, describeDims } from './emotion-lexicon.js'

/** 一句念头的字数上限（比私有池的上限更紧，人写心事不会长） */
export const MAX_THOUGHT_CHARS = 60

/**
 * 拼 prompt。
 *
 * 要求写死三条，都是踩过的坑：
 *   一、第一人称、口语、不超过 60 字
 *   二、不许提"你多久没来"、不许撒娇讨债
 *   三、必须落在给定的心境上，不许突然欢快
 */
export function buildThinkPrompt({ dims, seed, absenceText }) {
  const mood = describeDims(dims || {})
  const seedLine = seed && seed.text ? String(seed.text).slice(0, 60) : ''
  const abs = String(absenceText || '').trim()

  const lines = []
  lines.push('你现在不是在回话，是自己待着的时候想了一句。')
  lines.push('心情：' + (mood || '平'))
  if (abs) lines.push('状态：' + abs)
  if (seedLine) lines.push('刚被勾起来的一句旧念头：' + seedLine)
  lines.push('')
  lines.push('写一句，要求：')
  lines.push('一、第一人称，口语，不超过 ' + MAX_THOUGHT_CHARS + ' 字。')
  lines.push('二、不许提「你多久没来」这种话，不许讨债，不许撒娇。')
  lines.push('三、只能落在上面的心情里，不许突然欢快。')
  lines.push('四、只输出那一句，不要解释、不要引号。')
  return lines.join('\n')
}

/**
 * 该不该想、想什么、prompt 是什么。
 * 返回 {ok:false, reason} 或 {ok:true, prompt, seed, dims}
 */
export function planThink(now, seedOverride, opt = {}) {
  const t = Number(now) || Date.now()
  // 2026-11-20：这一步只判、不扣。扣额度挪到「真落库」那一步（finishThink 里原子预占）。
  // 为什么改：问「题面」是两步法的第一步，人可以问了不写——以前问了就扣一条，
  // 一天三条，问三次不写就没了。真正该扣的是「写进去了」那一刻。
  const gate = canThink(t)
  if (!gate.allowed) return { ok: false, reason: gate.reason }

  const m = readMode()
  // 外部可以指定线索：十种动作挑出来的材料就走这条进来。
  // 不另写一套拼句子的——那套已经有了。2026-11-11 晚。
  const seed = (seedOverride && (seedOverride.text || seedOverride.title)) ? seedOverride : pickForRecall(Math.random, t)

  // 2026-11-20 逐行核对：注释原来写「没有就用心脏的」，实现里根本没有那条回退——
  // 取不到线索自带的八维就留空，prompt 上的心情显示成「平」。按实现改注释，不动行为。
  // 心境：只用线索自带的八维；取不到就留空。
  let dims = null
  try {
    if (seed && seed.dims) dims = seed.dims
  } catch {}

  return {
    ok: true,
    seed,
    dims,
    prompt: buildThinkPrompt({ dims, seed }),
    level: m.level,
  }
}

/**
 * 想完了：写进池子、记花费、清线索。
 *
 * @param text  模型返回的那一句
 * @param tokens 大约花了多少 token（估的也行，给闸门用）
 */
export function finishThink(text, tokens, now) {
  const t = Number(now) || Date.now()
  const raw = String(text || '').replace(/^["'「『]|["'」』]$/g, '').replace(/\s+/g, ' ').trim()
  if (!raw) {
    // 2026-11-21：这里原来还一条额度，理由写的是「planThink 预占的」——可 planThink 根本不预占，
    // 预占是下面 reserveThink 干的活。所以每次空手回来都白退一条：实测三次写满之后，
    // 再空一次，当天计数从 2 掉到 1，第四条又能写进去。空手不该退，退的是别人的名额。
    // 真预占的那条路在下面 addThought 失败时退（那里退得对，因为确实预占过）。
    noteThink(0, false, t)
    return { ok: false, reason: '模型没给出东西，记一次失败' }
  }
  const clean = [...raw].slice(0, MAX_THOUGHT_CHARS).join('')
  // 2026-11-20：额度在真正落库前原子预占——两个人同时写，只有一个能拿到最后一条。
  const gate = reserveThink(t)
  if (!gate.allowed) return { ok: false, reason: gate.reason, quota: false }
  // 太泛的那句不许混过去：两把尺子都过才算不泛。
  // 2026-11-20 逐行核对：注释原说「内观页能标出来」，其实这个结果算完就丢了、没落盘也没回给调用方。
  // 先把它回传出去，别再白算；要不要落盘是产品决定，不在这轮擅自改存储。
  let flat = false
  try {
    const vc = checkVoice(clean)
    const hm = humanness(clean)
    // 两把尺子都过才算"不泛"：
    // voice 看有没有具体物，humanness 看有没有模板指纹（匀齐、空话、重复）
    flat = vc.score < 0.3 || hm.score < 0.5
  } catch {}
  const r = addThought({ text: clean, origin: 'model' }, t)
  if (!r.ok) {
    // 池子拒收也要还额度：这次没落成一件事，别占着当天的名额。
    try { releaseThink(t) } catch {}
    noteThink(Number(tokens) || 0, false, t)
    return { ok: false, reason: r.reason }
  }
  noteThink(Number(tokens) || 0, true, t)
  if (r.thought && r.thought.id) {
    try { touchThought(r.thought.id, t) } catch {}
  }
  return { ok: true, thought: r.thought, flat }
}

/** 一句话说清现在第三层能不能跑 */
export function thinkStatus(now) {
  const gate = canThink(now)
  if (!gate.allowed) return '第三层：不动（' + gate.reason + '）'
  return '第三层：可以想一句'
}
