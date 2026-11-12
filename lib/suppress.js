/**
 * 表达抑制：记忆浮上来了，也未必该说。
 *
 * 判断只看三件事，不猜：
 *   1. 这条是不是琐事（重要度和唤醒都低）
 *   2. 这会儿的氛围跟它冲不冲突（你正绷着，我偏提一件很轻的旧事）
 *   3. 刚说过没有（冷却）
 *
 * 返回 { speak, reason }，reason 一定是 trivial / clash / cooldown / ok 之一。
 * 2026-11-11 晚。
 */

const DAY = 86400000

/* 冷却记账：说出口的时间要落盘。
 * 只放内存的话，重启就清空——同一件事开个新窗口就能再说一遍。2026-11-11。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SPOKEN_FILE = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-spoken.json')

function loadSpoken() {
  const m = new Map()
  try {
    if (!existsSync(SPOKEN_FILE)) return m
    const raw = JSON.parse(readFileSync(SPOKEN_FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
    const cut = Date.now() - 7 * DAY
    for (const k of Object.keys(raw)) {
      const v = Number(raw[k]) || 0
      if (v > cut) m.set(k, v)
    }
  } catch {}
  return m
}

function saveSpoken(m) {
  try {
    const o = {}
    for (const [k, v] of m) o[k] = v
    writeFileSync(SPOKEN_FILE, JSON.stringify(o), 'utf8')
  } catch {}
}

const spoken = loadSpoken()

/** 归一化到 0~1 */
const n01 = (v, max = 1) => Math.max(0, Math.min(1, (Number(v) || 0) / max))

/**
 * @param {object} mem   记忆
 * @param {object} mood  { polarity, arousal } 当前氛围
 * @param {object} opt   { now, cooldownMin, trivialImp, trivialArousal, clashGap }
 */
export function shouldSpeak(mem, mood, opt = {}) {
  const now = opt.now || Date.now()
  const cooldownMs = (opt.cooldownMin == null ? 45 : opt.cooldownMin) * 60000
  const trivialImp = opt.trivialImp == null ? 0.35 : opt.trivialImp
  const trivialArousal = opt.trivialArousal == null ? 3 : opt.trivialArousal
  const clashGap = opt.clashGap == null ? 0.75 : opt.clashGap

  if (!mem) return { speak: false, reason: 'trivial' }

  const key = String(mem.id == null ? mem.title : mem.id)
  const last = spoken.get(key) || 0
  if (now - last < cooldownMs) return { speak: false, reason: 'cooldown' }

  const imp = n01(mem.imp)
  const ar = Number(mem.arousal) || 0

  // 相对判据：候选池里最弱的那批按住。
  // 为什么改：原来用绝对线（重要度 <0.35 且唤醒 <3）才算琐事，可真实记忆里
  // 几乎不存在这么低的——于是这道闸从来没合上过（实测 72 次主动想起，0 次按住）。
  // 人的抑制不是"低于某条线就不说"，是"这几个里面，弱的先让位"。
  const poolSize = Number(opt.poolSize) || 0
  const rank = Number(opt.rank) || 0
  const weakCut = opt.weakCut == null ? 0.3 : opt.weakCut   // 池子里最弱的 30%
  if (poolSize >= 4 && rank > 0) {
    const strength = (imp * 0.6 + n01(ar, 10) * 0.4)
    const poolAvg = Number(opt.poolAvg)
    if (Number.isFinite(poolAvg) && strength < poolAvg * (1 - weakCut) && rank > poolSize * (1 - weakCut)) {
      return { speak: false, reason: 'trivial' }
    }
  }

  // 绝对兜底：真的两样都低，那确实是琐事
  if (imp < trivialImp && ar < trivialArousal) return { speak: false, reason: 'trivial' }

  // 氛围冲突：极性相反、而且都够强，就别硬提
  const mp = Number(mem.polarity) || 0
  const ap = Number(mood && mood.polarity) || 0
  const moodA = n01((mood && mood.arousal) || 0, 10)
  const memA = n01(ar, 10)
  if (mp * ap < 0 && Math.abs(mp) > 0.4 && Math.abs(ap) > 0.4 && (memA + moodA) / 2 > 0.5) {
    return { speak: false, reason: 'clash' }
  }
  const _ = DAY
  return { speak: true, reason: 'ok' }
}

/** 说出口了，记一笔冷却 */
export function markSpoken(mem, now = Date.now()) {
  if (!mem) return
  spoken.set(String(mem.id == null ? mem.title : mem.id), now)
  saveSpoken(spoken)
}

/** 给一组候选过一遍，返回能说的那些（带理由） */
export function filterSpeakable(list, mood, opt) {
  const out = []
  for (const x of list || []) {
    const mem = (x && x.p) || x
    const v = shouldSpeak(mem, mood, opt)
    if (v.speak) out.push({ p: mem, reason: v.reason, score: (x && x.score) || 0 })
  }
  return out
}

/** 调试用：看看现在存了什么 */
export function spokenCount() { return spoken.size }
