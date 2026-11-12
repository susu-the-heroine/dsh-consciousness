/**
 * 念这句。
 *
 * 插件自己不发声——没模型、没显卡、也不把话发到云上。
 * 只做一件事：把"要念的字"交给用户自己的 TTS，用户配什么就用什么。
 *
 * 配置：~/.dsh/consciousness-voice.json
 * {
 *   "cmd": "C:\\AI-DDSP\\env_tts\\Scripts\\python.exe",
 *   "args": ["D:\\AISong\\scripts\\speak_feiyu.py", "--text", "{text}", "--emotion", "{emotion}", "--out", "{out}"],
 *   "emotion": "tender",
 *   "timeoutMs": 120000
 * }
 *
 * {text} / {out} / {emotion} 会被替换；{out} 指向一个空的 .wav 路径，脚本自己写。
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

export const VOICE_CONFIG = join(homedir(), '.dsh', 'consciousness-voice.json')
export const VOICE_DIR = join(homedir(), '.dsh', 'consciousness-voice')

export function readVoiceConfig() {
  try {
    if (!existsSync(VOICE_CONFIG)) return null
    const raw = readFileSync(VOICE_CONFIG, 'utf8').replace(/^\uFEFF/, '')
    const c = JSON.parse(raw)
    if (!c || !String(c.cmd || '').trim()) return null
    return {
      cmd: String(c.cmd),
      args: Array.isArray(c.args) ? c.args.map(String) : [],
      emotion: String(c.emotion || ''),
      timeoutMs: Math.max(5000, Math.min(300000, Number(c.timeoutMs) || 120000)),
    }
  } catch {
    return null
  }
}

export function voiceReady() {
  const c = readVoiceConfig()
  return !!(c && existsSync(c.cmd))
}

/**
 * 念一句。没有配置就明说"没接引擎"，不假装。
 * @returns {Promise<{ok:boolean, file?:string, reason?:string, engine?:string}>}
 */
export async function speak(text, opts = {}) {
  const s = String(text || '').trim()
  if (!s) return { ok: false, reason: '没字可念' }
  if (s.length > 500) return { ok: false, reason: '太长了，一次最多 500 字' }

  const c = readVoiceConfig()
  if (!c) return { ok: false, reason: '没配声音引擎（~/.dsh/consciousness-voice.json）' }
  if (!existsSync(c.cmd)) return { ok: false, reason: '配了引擎，但那个程序不在：' + c.cmd }

  mkdirSync(VOICE_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = join(VOICE_DIR, `say-${stamp}.wav`)
  const emotion = String(opts.emotion || c.emotion || '').trim()

  const args = c.args.map((a) => a
    .replace(/\{text\}/g, s)
    .replace(/\{out\}/g, out)
    .replace(/\{emotion\}/g, emotion))

  try {
    await new Promise((resolve, reject) => {
      execFile(c.cmd, args, { timeout: c.timeoutMs }, (err) => (err ? reject(err) : resolve()))
    })
    if (!existsSync(out)) return { ok: false, reason: '引擎跑完了，但没生成文件' }
    return { ok: true, file: out, url: '/consciousness/voice?name=' + encodeURIComponent(out.split(/[\\/]/).pop()), engine: c.cmd }
  } catch (e) {
    return { ok: false, reason: '引擎报错：' + String((e && e.message) || e).slice(0, 120) }
  }
}

// ---------------------------------------------------------------------------
// 异步念：开一个后台任务，立刻返回 id。
// 2026-11-08 教训：把几分钟的 TTS 直接 await 在网页请求里，点一下整页卡住。
// 现在改成"点一下就走"，前端轮询结果。
// 同一时间只允许一个任务，别把机器压死。
// ---------------------------------------------------------------------------
const JOBS = new Map()
let RUNNING = false

export function startSpeak(text, opts = {}) {
  const s = String(text || '').trim()
  if (!s) return { ok: false, reason: '没字可念' }
  if (RUNNING) return { ok: false, busy: true, reason: '上一句还在念' }

  const id = 'j' + Date.now().toString(36)
  JOBS.set(id, { at: Date.now(), state: 'running' })
  RUNNING = true
  speak(s, opts)
    .then((r) => { JOBS.set(id, { at: Date.now(), state: r.ok ? 'done' : 'fail', ...r }) })
    .catch((e) => { JOBS.set(id, { at: Date.now(), state: 'fail', reason: String((e && e.message) || e).slice(0, 120) }) })
    .finally(() => { RUNNING = false })

  // 十分钟前的记录清掉
  for (const [k, v] of JOBS) if (Date.now() - v.at > 600000) JOBS.delete(k)
  return { ok: true, job: id }
}

export function speakStatus(id) {
  const j = JOBS.get(String(id || ''))
  if (!j) return { ok: false, reason: '没这个任务' }
  return { ok: true, ...j }
}
