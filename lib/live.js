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
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// 2026-11-20：加一个测试用的路径覆盖（跟自模式、私心池一个做法），否则这文件根本没法在沙箱里验。
const FILE = String(process.env.DSH_LIVE_FILE || '').trim()
  || join(homedir(), '.dsh', 'consciousness-live.json')

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
  // 2026-11-20：自检模式那个开关（0=慢性提醒，1=立刻让她重说）。
  // 说明里写着「改这个文件里的 instantRetry」，可默认表里根本没这一项——
  // 读文件只认表里有的键，于是这个开关永远是 0，等于没做过。
  instantRetry: 0,
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
      // 2026-11-20：读的时候也要夹。这文件是给人手改的——写入口夹了，手改那一路没夹，
      // 填个 999999 就能把注入上限顶到天上。读的时候按同一套区间夹一次。
      if (Number.isFinite(v)) out[k] = sane(k, v)
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
    // 2026-11-21：写之前先留上一份。今晚他调过的那份被一份测试顺手删了，
    // 翻遍全盘没有副本——以后每次改参数都留个尾巴，丢一次不至于从头猜。
    let _bakWarn = ''
    try {
      if (existsSync(FILE)) copyFileSync(FILE, FILE + '.bak')
    } catch (e) {
      // 2026-11-21：这里原来整段吞掉。上一版参数被他调好后没留副本、被一次测试顺手删掉，
      // 全盘翻遍都没有第二份——改完加了这行备份，可备份失败一样不出声。
      // 实测：把 .bak 的位置先占成目录，复制抛错、新参数照写、返回还是「成功」，一句提示都没有。
      _bakWarn = '上一版没备份成，退不回去了：' + String((e && e.message) || e).slice(0, 60)
    }
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify({ ...next, at: Date.now() }), 'utf8')
    renameSync(tmp, FILE)
    const _out = { ok: true, now: next }
    if (_bakWarn) _out.warn = _bakWarn
    return _out
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
    // 2026-11-20：affinityMax 在默认表里，却没在这张表里——写进来多少就是多少，
    // 「写的时候就夹紧」对它是句空话。落到 default 前先接住。
    case 'affinityMax': return Math.max(0, Math.min(0.5, n))
    case 'instantRetry': return n > 0 ? 1 : 0
    default: return n
  }
}
