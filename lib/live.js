/**
 * 热参数：改完立刻生效，不用重启
 * ============================
 *
 * 为什么要这个：改一行代码要重启一次，今晚重启了十几次。
 * 但**大部分调整不是改逻辑，是调数字**——上限、阈值、阻尼。
 * 数字没必要走重启。
 *
 * 存在 `~/.dsh/consciousness-live.json`，每次用到时读一次（很便宜）。
 * 改完立刻生效：注入上限、质量阈值、短句语义阈值、阻尼。
 *
 * **只放数字。** 逻辑改动仍然要重启——这条不装。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-live.json')

export const DEFAULTS = {
  // 注入体积上限（字）
  capMax: 2200,
  // 记忆质量：低于任一就标"泛"
  flatVoice: 0.3,
  flatHuman: 0.45,
  // 短句（≤8 字）的语义阈值
  shortQuerySim: 0.15,
  // 长句语义阈值
  longQuerySim: 0.35,
  // 阻尼（和 damping.json 同义，这里方便一起调）
  damp: 0.45,
  // 念头的日额度
  dailyThoughts: 3,
  // 情绪同频最多加多少分。调它就能试八维影响够不够，不用重启。
  affinityMax: 0.1,
}

const KEYS = Object.keys(DEFAULTS)

export function livePath() {
  return FILE
}

export function readLive() {
  const out = { ...DEFAULTS }
  try {
    if (!existsSync(FILE)) return out
    const j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    for (const k of KEYS) {
      const v = Number(j && j[k])
      if (Number.isFinite(v)) out[k] = v
    }
  } catch {}
  return out
}

export function writeLive(patch) {
  const cur = readLive()
  const next = { ...cur }
  for (const k of KEYS) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, k)) {
      const v = Number(patch[k])
      // 写的时候就夹紧：手滑填个 999999 也不能把系统搞死
      if (Number.isFinite(v)) next[k] = sane(k, v)
    }
  }
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify({ ...next, at: Date.now() }), 'utf8')
    renameSync(tmp, FILE)
    return { ok: true, now: next }
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) }
  }
}

/** 夹在合理区间，别让手滑把系统搞死 */
export function sane(key, v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULTS[key]
  switch (key) {
    case 'capMax': return Math.max(400, Math.min(8000, n))
    case 'flatVoice': case 'flatHuman': return Math.max(0, Math.min(1, n))
    case 'shortQuerySim': case 'longQuerySim': return Math.max(0.05, Math.min(0.9, n))
    case 'damp': return Math.max(0, Math.min(1, n))
    case 'dailyThoughts': return Math.max(0, Math.min(20, Math.round(n)))
    default: return n
  }
}
