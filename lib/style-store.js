/**
 * 风格条目的存取（独立小文件版）
 * ==============================
 * 2026-11-22 第二版。第一版存在海文件里（241 MB），注入每轮要解析整份海，
 * 直接把消息卡死。苏苏侠卸载识海之后我才把这条想明白。
 *
 * 现在的规矩：
 *   一、风格单独一个文件 `~/.dsh/consciousness-style.json`，按海分键，只有几十条、几 KB。
 *   二、注入路径只读这个小文件，永远不碰海。
 *   三、一次扫描只写一次（upsertMany 合并）。
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

const FILE = `${homedir()}/.dsh/consciousness-style.json`
const MIN_COUNT = 3
const MIN_DAYS = 2
const MIN_TEXTS = 2
// 只认能验的四类；口癖（tic-xxx）自动抽出来全是噪音，不许进注入
const OK_CATS = ['标点', '语气', '句长', '骂人']

function readAll() {
  try {
    if (!existsSync(FILE)) return {}
    const o = JSON.parse(readFileSync(FILE, 'utf8'))
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}

function writeAll(o) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeJsonAtomic(FILE, o)
  } catch {}
}

function dayOf(at) {
  return new Date(Number(at) || Date.now()).toISOString().slice(0, 10)
}

function list(sea) {
  const all = readAll()
  const arr = all[String(sea || 'main')]
  return Array.isArray(arr) ? arr : []
}

/** 落一条观察。返回 { created } */
export function upsertStyle(sea, obs, opt = {}) {
  const r = upsertMany(sea, [{ obs, at: opt.at, text: opt.text }], { turn: opt.turn, maxNew: 1 })
  return { created: r.created > 0 }
}

/** 批量落库：一次只写一次小文件。items = [{ obs, at, text }] */
export function upsertMany(sea, items, opt = {}) {
  const listIn = Array.isArray(items) ? items : []
  if (!listIn.length) return { created: 0 }
  const key = String(sea || 'main')
  const maxNew = Number(opt.maxNew) || 3
  const turn = Number(opt.turn) || 0
  const all = readAll()
  const arr = Array.isArray(all[key]) ? all[key] : (all[key] = [])
  let created = 0
  let maxId = 0
  for (const p of arr) maxId = Math.max(maxId, Number(p.id) || 0)

  for (const it of listIn) {
    const obs = it && it.obs
    const sk = String((obs && obs.key) || '').trim()
    if (!sk) continue
    const at = Number(it.at) || Date.now()
    const day = dayOf(at)
    const text = String(it.text || obs.sample || '').slice(0, 120)
    let p = arr.find((x) => x && x.styleKey === sk)
    if (!p) {
      if (created >= maxNew) continue
      p = {
        id: ++maxId,
        styleKey: sk,
        cat: obs.cat || '',
        title: obs.pattern || sk,
        count: 0,
        days: [],
        texts: [],
        adopt: false,
        conf: 0.4,
        noLearn: false,
        lastSeenAt: 0,
      }
      arr.push(p)
      created++
    }
    p.count = (Number(p.count) || 0) + 1
    p.days = Array.isArray(p.days) ? p.days : []
    if (day && !p.days.includes(day)) p.days.push(day)
    p.texts = Array.isArray(p.texts) ? p.texts : []
    if (text && !p.texts.includes(text) && p.texts.length < 5) p.texts.push(text)
    p.lastSeenAt = at
    if (p.noLearn !== true && Number(p.count) >= MIN_COUNT && p.days.length >= MIN_DAYS && p.texts.length >= MIN_TEXTS) {
      p.adopt = true
      p.adoptedAtTurn = turn || p.adoptedAtTurn || 0
      p.conf = Math.min(0.9, 0.4 + 0.1 * Math.min(5, Number(p.count) - MIN_COUNT + 1) + 0.1 * (p.days.length - MIN_DAYS))
    }
  }
  writeAll(all)
  return { created }
}

/** 列出这个海的风格条目 */
export function listStyle(sea) {
  return list(sea)
}

/** 用户说「别学这个」：钉死，永不采纳 */
export function markNoLearn(sea, key, why = '') {
  const all = readAll()
  const arr = Array.isArray(all[String(sea || 'main')]) ? all[String(sea || 'main')] : []
  const p = arr.find((x) => x && x.styleKey === key)
  if (!p) return null
  p.noLearn = true
  p.adopt = false
  p.conf = 0
  p.noLearnWhy = String(why || '').slice(0, 80)
  p.noLearnAt = Date.now()
  writeAll(all)
  return p
}

/** 注入候选：跟的、没被钉死的、只认四类 */
export function styleCandidates(sea) {
  return list(sea)
    .filter((p) => p && p.adopt === true && p.noLearn !== true)
    .filter((p) => OK_CATS.includes(String(p.cat || '')))
    .map((p) => ({
      id: p.id,
      key: p.styleKey,
      pattern: String(p.title || ''),
      conf: Number(p.conf) || 0,
      lastUsedDay: p.lastUsedDay || '',
      lastSeenAt: Number(p.lastSeenAt) || 0,
    }))
}

/** 记一次用过 */
export function markStyleUsed(sea, key, day, turn) {
  const all = readAll()
  const arr = Array.isArray(all[String(sea || 'main')]) ? all[String(sea || 'main')] : []
  const p = arr.find((x) => x && x.styleKey === key)
  if (!p) return null
  p.lastUsedDay = String(day || dayOf(Date.now()))
  p.lastUsedAt = Date.now()
  p.lastUsedTurn = Number(turn) || 0
  writeAll(all)
  return p
}

export function styleFilePath() { return FILE }
