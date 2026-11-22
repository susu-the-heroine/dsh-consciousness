/**
 * 她自己的底：self 条目（独立小文件版）
 * ====================================
 * 2026-11-22 第二版。第一版把 self 存进海文件（241 MB），读取要解析整份海；
 * 注入每轮都读一次，等于把消息卡死。改成独立小文件，注入只读几 KB。
 *
 * 规矩（苏苏侠定的）：
 *   - 只叠不盖：新的一条进来，旧的标 superseded，正文一个字不动
 *   - 依据要留
 *   - 注入只带最新一条
 *   - 提料只读 raw 尾巴，不碰海（海太大，读一次就是几秒）
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readSea } from './store.js'

const FILE = `${homedir()}/.dsh/consciousness-self-notes.json`
const ROOT = join(homedir(), '.dsh', 'consciousness-seas')
const TAIL_BYTES = 120 * 1024

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

function list(sea) {
  const all = readAll()
  const arr = all[String(sea || 'main')]
  return Array.isArray(arr) ? arr : []
}

function save(sea, arr) {
  const all = readAll()
  all[String(sea || 'main')] = arr
  writeAll(all)
}

/** 写一条 self：旧的全部标被推翻，正文不动 */
export function addSelf(sea, input = {}) {
  const text = String(input.text || '').trim()
  if (!text) return null
  const at = Number(input.at) || Date.now()
  const arr = list(sea)
  let maxId = 0
  for (const p of arr) maxId = Math.max(maxId, Number(p.id) || 0)
  for (const p of arr) {
    if (p.superseded !== true) {
      p.superseded = true
      p.supersededAt = at
    }
  }
  const p = {
    id: maxId + 1,
    text: text.slice(0, 200),
    title: String(input.title || '我现在的样子').slice(0, 40),
    basis: Array.isArray(input.basis) ? input.basis.slice(0, 6) : [],
    selfAt: at,
    superseded: false,
  }
  arr.push(p)
  save(sea, arr)
  return p
}

/** 列出来：默认只要现行的 */
export function listSelf(sea, opt = {}) {
  const all = list(sea).slice().sort((a, b) => (Number(b.selfAt) || 0) - (Number(a.selfAt) || 0))
  return opt.all === true ? all : all.filter((p) => p.superseded !== true)
}

/** 注入用：最新一条现行 self */
export function selfForInject(sea) {
  const p = listSelf(sea)[0]
  if (!p) return null
  return { id: p.id, text: String(p.text || '').slice(0, 160), at: Number(p.selfAt) || 0 }
}

/** 到点了没有：每 100 轮，或今天还没自述过 */
export function selfDue(sea, opt = {}) {
  const turns = Number(opt.turns) || 0
  const now = Number(opt.now) || Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const last = listSelf(sea)[0]
  if (!last) return { due: true, why: '还没有一条' }
  if (turns > 0 && turns % 100 === 0) return { due: true, why: '满 ' + turns + ' 轮' }
  const lastDay = new Date(Number(last.selfAt) || 0).toISOString().slice(0, 10)
  if (lastDay !== today) return { due: true, why: '今天还没自述' }
  return { due: false, why: '' }
}

/**
 * 提料：从记忆里捡三条给她自述用（后悔 / 他的评价 / 她的选择）。
 *
 * 2026-11-22 更正：先前以为「读海贵」，量完是错的——
 * data.json 只有 0.8 MB、373 条，读一次加解析 5 ms。
 * 贵的是 raw（171 MB）和每次写都复制备份。所以这里直接读记忆，别读 raw。
 */
export function selfHints(sea, opt = {}) {
  const want = Number(opt.limit) || 3
  const out = []
  let pts = []
  try {
    const d = readSea(sea)
    pts = Array.isArray(d && d.points) ? d.points : []
  } catch { return out }
  const push = (prefix, t, from) => {
    if (out.length >= want || !t) return
    out.push({ line: prefix + String(t).slice(0, 40), from: '#' + from })
  }

  // 一、她后悔过的：regret 字段（旧数据在 herRegret / 后来后悔 里）
  for (const p of pts) {
    if (out.length >= want) break
    const r = String((p && (p.regret || p.herRegret || p.later)) || '').trim()
    if (r) push('后悔：', r, p.id)
  }
  // 二、他对她的评价：标签里带「评价」的，或者正文里那句原话
  const QUOTE = /(你(?:他妈|他妈的|真|就是|这人|怎么)?[^。！？]{0,10}(傻|废物|不错|挺好|牛|敷衍|爹味))|他骂我|他夸我|他说我/
  for (const p of pts) {
    if (out.length >= want) break
    const t = String((p && (p.text || p.title)) || '')
    const m = t.match(QUOTE)
    if (m) push('评价：', m[0], p.id)
  }
  // 三、她做过的选择（顶回去 / 忍了 / 闭嘴 / 认了）
  const CHOICE = /(顶回去|认怂|忍了|没还嘴|闭嘴|认了|没删)/
  for (const p of pts) {
    if (out.length >= want) break
    const t = String((p && (p.text || p.title)) || '')
    const m = t.match(CHOICE)
    if (m) push('选择：', m[0], p.id)
  }
  return out
}

export function selfFilePath() { return FILE }
