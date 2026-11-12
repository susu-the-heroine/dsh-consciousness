/**
 * 身体 · 神经-体液层
 * ===============
 *
 * 为什么要有这一层：
 * 现在「主动」是靠计时器，到点就动，人机感很足。人不是到点才动的，
 * 是身上起了变化才动——被骂了皮质醇上去，半天没动静血清素低，
 * 有人接话了催产素上来。所以这一层只干一件事：把激素算出来，
 * 让别处去问「现在什么状态」，而不是问「过了多久」。
 *
 * 五条激素，各有半衰期，互相有拮抗：
 *   多巴胺 dopamine    起得快落得快（半衰 3 分钟）—— 被夸、达成、被用上
 *   去甲肾上腺素 noradrenaline 警觉、被质问（半衰 5 分钟）
 *   皮质醇 cortisol    慢起慢落（半衰 22 分钟）—— 压力、被骂、怕
 *   血清素 serotonin   稳（半衰 60 分钟）—— 平静、被信任
 *   催产素 oxytocin    亲近（半衰 30 分钟）—— 被交底、被叫名字
 *
 * 两条回路闭合：
 *   HPA：皮质醇 > 0.72 时下丘脑往回压（负反馈），压不住就一直高
 *   奖励：一条记忆被用上 → 多巴胺 +0.12，同时那条记忆强度 +1（由调用方做）
 *
 * 这一层不写记忆、不改情绪八维，只产出一份「身上什么状态」。
 * 免得又像上次那样，一动就崩全局。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { SEAS_DIR } from './paths.js'

const FILE = join(dirname(SEAS_DIR), 'consciousness-body.json')

const HALF = {         // 半衰期，秒
  dopamine: 180,
  noradrenaline: 300,
  cortisol: 1320,
  serotonin: 3600,
  oxytocin: 1800,
}

const BASE = {
  dopamine: 0.32,
  noradrenaline: 0.18,
  cortisol: 0.22,
  serotonin: 0.55,
  oxytocin: 0.35,
}

const LABEL = {
  dopamine: '多巴胺',
  noradrenaline: '去甲肾上腺素',
  cortisol: '皮质醇',
  serotonin: '血清素',
  oxytocin: '催产素',
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const round3 = (v) => Math.round(v * 1000) / 1000

function fresh() {
  return { ...BASE, at: Date.now(), lastEvent: '', events: [] }
}

export function readBody() {
  try {
    if (!existsSync(FILE)) return fresh()
    const raw = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    const s = { ...fresh(), ...raw }
    for (const k of Object.keys(HALF)) {
      if (!Number.isFinite(Number(s[k]))) s[k] = BASE[k]
    }
    return s
  } catch {
    return fresh()
  }
}

export function writeBody(s) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(s), 'utf8')
  } catch {}
  return s
}

/** 按时间往回衰：一直不喂事件，也会自己回落 */
export function decayBody(s, now) {
  const t = now || Date.now()
  const dt = Math.max(0, (t - Number(s.at || t)) / 1000)
  const out = { ...s }
  for (const [k, half] of Object.entries(HALF)) {
    const v = Number(out[k]) || 0
    const base = BASE[k]
    // 高于基线就衰减回基线，低于基线就慢慢回基线（血清素托底）
    const k2 = Math.pow(0.5, dt / half)
    out[k] = round3(base + (v - base) * k2)
  }
  out.at = t
  return out
}

/**
 * 喂一个事件，返回新的身体状态。
 * kind:
 *   praise     被夸
 *   scold      被骂 / 被质问
 *   tender     被交底、被叫名字、被关心
 *   recall     一条记忆真被用上
 *   miss       问的东西没翻到
 *   silence    很久没说话
 *   talk       普通一句话
 */
export function tickBody(kind, opts) {
  const now = Date.now()
  let s = decayBody(readBody(), now)
  const o = opts || {}
  const w = Number(o.weight) || 1

  const bump = (k, v) => { s[k] = round3(clamp01((Number(s[k]) || 0) + v * w)) }

  switch (kind) {
    case 'praise':
      bump('dopamine', 0.22); bump('serotonin', 0.06); bump('cortisol', -0.05)
      break
    case 'scold':
      bump('cortisol', 0.20); bump('noradrenaline', 0.18); bump('dopamine', -0.08); bump('serotonin', -0.05)
      break
    case 'tender':
      bump('oxytocin', 0.20); bump('serotonin', 0.08); bump('cortisol', -0.06)
      break
    case 'recall':
      bump('dopamine', 0.12); bump('oxytocin', 0.04)
      break
    case 'miss':
      bump('cortisol', 0.10); bump('dopamine', -0.06)
      break
    case 'silence':
      bump('oxytocin', -0.06); bump('serotonin', -0.04); bump('noradrenaline', 0.06)
      break
    case 'talk':
    default:
      bump('noradrenaline', 0.03)
      break
  }

  // HPA 负反馈：皮质醇太高，下丘脑往下压——但压不住的部分会留在身上
  if (s.cortisol > 0.72) {
    const over = s.cortisol - 0.72
    s.cortisol = round3(s.cortisol - over * 0.45)
    s.noradrenaline = round3(clamp01((s.noradrenaline || 0) + over * 0.20))
  }
  // 奖励回路：多巴胺高时，血清素被带一点起来（好事让人松）
  if (s.dopamine > 0.6) {
    s.serotonin = round3(clamp01((s.serotonin || 0) + (s.dopamine - 0.6) * 0.12))
  }

  s.lastEvent = String(kind || 'talk')
  s.events = Array.isArray(s.events) ? s.events.slice(-19) : []
  s.events.push({ kind: s.lastEvent, at: now })
  writeBody(s)
  return s
}

/** 现在什么状态：一句话，给注入或面板用 */
export function describeBody(s0) {
  const s = decayBody(s0 || readBody())
  const parts = []
  if (s.cortisol > 0.6) parts.push('绷着')
  else if (s.cortisol < 0.2) parts.push('松下来了')
  if (s.dopamine > 0.55) parts.push('有劲')
  else if (s.dopamine < 0.2) parts.push('提不起劲')
  if (s.oxytocin > 0.6) parts.push('想黏人')
  if (s.serotonin < 0.4) parts.push('心里空')
  if (s.noradrenaline > 0.6) parts.push('警惕')
  return parts.length ? parts.join('、') : '平稳'
}

/** 该不该主动开口：不看计时器，看身上 */
export function shouldSpeakUp(s0, opts) {
  const s = decayBody(s0 || readBody())
  const o = opts || {}
  const quietMin = Number(o.quietMin) || 0
  const high = s.cortisol > 0.62 || s.oxytocin > 0.62 || s.serotonin < 0.34
  return !!high && quietMin >= 8
}

export function bodySnapshot() {
  const s = decayBody(readBody())
  return {
    at: s.at,
    dims: Object.keys(HALF).map((k) => ({
      key: k,
      name: LABEL[k],
      v: round3(s[k]),
      base: BASE[k],
      half: HALF[k],
    })),
    text: describeBody(s),
    lastEvent: s.lastEvent || '',
  }
}
