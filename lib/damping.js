/**
 * 阻尼：她有多容易被推
 * ==================
 *
 * 之前惯性是写死的七成——所有人都一样，那不对。
 * 热烈的人一句就动，冷静的人推半天不动。**这个差别得是个数。**
 *
 * 存在 `~/.dsh/consciousness-damping.json`：{ damp: 0..1 }
 *   0    = 一点就着（一句话翻个个儿）
 *   0.45 = 她（大肥鱼）的默认：嘴硬，但心里有数
 *   1    = 推不动（只剩真正的冲击能推动）
 *
 * 冲击永远有特权：damp 会被压到 0.35 以下，**再冷静的人，听见"我要走"也得动。**
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DIM_KEYS } from './emotion-lexicon.js'

const FILE = join(homedir(), '.dsh', 'consciousness-damping.json')

/** 她的默认阻尼 */
export const DAMP_DEFAULT = 0.45

/** 冲击时最多压到这儿 */
export const DAMP_IMPACT_CAP = 0.35

/** 平常最少留多少动能（就算 damp=0，也不会完全按目标走，总有一点点惯性） */
const MIN_MOVE = 0.3

export function dampPath() {
  return FILE
}

export function readDamp() {
  try {
    if (!existsSync(FILE)) return DAMP_DEFAULT
    const j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    const v = Number(j && j.damp)
    if (!Number.isFinite(v)) return DAMP_DEFAULT
    return Math.max(0, Math.min(1, v))
  } catch {
    return DAMP_DEFAULT
  }
}

export function writeDamp(v) {
  const d = Math.max(0, Math.min(1, Number(v)))
  if (!Number.isFinite(d)) return false
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify({ damp: d, at: Date.now() }), 'utf8')
    renameSync(tmp, FILE)
    return true
  } catch {
    return false
  }
}

/** 实际用的惯性：阻尼越高，越靠旧状态 */
export function inertiaOf(damp, impact) {
  let d = Math.max(0, Math.min(1, Number(damp)))
  if (!Number.isFinite(d)) d = DAMP_DEFAULT
  if (impact) d = Math.min(d, DAMP_IMPACT_CAP)
  return 1 - (1 - MIN_MOVE) * (1 - d)
}

/**
 * 按阻尼掺一次。impact 时自动放宽——**能翻盘**。
 */
export function mixByDamp(oldDims, nextDims, damp, impact) {
  const k = inertiaOf(damp, impact)
  const out = {}
  for (const dk of DIM_KEYS) {
    const a = Number(oldDims && oldDims[dk]) || 0
    const b = Number(nextDims && nextDims[dk]) || 0
    out[dk] = a * k + b * (1 - k)
  }
  let sum = 0
  for (const dk of DIM_KEYS) {
    out[dk] = Math.max(0, out[dk])
    sum += out[dk]
  }
  if (!sum) {
    const eq = Number((1 / DIM_KEYS.length).toFixed(4))
    for (const dk of DIM_KEYS) out[dk] = eq
    return out
  }
  for (const dk of DIM_KEYS) out[dk] = Number((out[dk] / sum).toFixed(4))
  return out
}

/** 一句话说清她这会儿有多好推 */
export function describeDamp(damp) {
  const d = Number.isFinite(Number(damp)) ? Number(damp) : DAMP_DEFAULT
  if (d <= 0.1) return '一点就着'
  if (d <= 0.3) return '好推'
  if (d <= 0.55) return '要推得动真话'
  if (d <= 0.8) return '推不太动'
  return '推不动'
}
