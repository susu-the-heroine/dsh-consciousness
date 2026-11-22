/**
 * 风格采集的定时/节流入口
 * ========================
 * 2026-11-22 新增，同日翻车重写。
 *
 * 翻车记录（别再犯）：第一版拿 readFileSync 把 raw 全读一遍（19 个文件、171.7 MB），
 * 又对每条观察单独 mutateSea 一次（海 241 MB，每次全量重写 + 备份）。
 * 结果：注入被卡死，消息发不出去、也不报错，历史加载不出来，苏苏侠把识海删了。
 *
 * 现在四条硬约束：
 *   一、只读最新那个 raw 文件的「尾巴」，最多 200 KB；不看整个历史。
 *   二、一次扫描最多 30 条消息、最多新增 3 条风格，风格条目总数封顶 30。
 *   三、一次扫描只写一次海（upsertMany 合并写），不再逐条写。
 *   四、默认关：tuning.styleOn 不为 1，这段不跑。
 */
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync, mkdirSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { observe } from './styleharvest.js'
import { upsertMany, listStyle } from './style-store.js'
import { tuning } from './tuning.js'

const ROOT = join(homedir(), '.dsh', 'consciousness-seas')
const STATE = join(homedir(), '.dsh', 'consciousness-style-scan.json')
const MIN_GAP = 10 * 60 * 1000
const TAIL_BYTES = 200 * 1024
const MAX_MSGS = 30
const MAX_NEW = 3
const MAX_POINTS = 30

function readState() {
  try {
    if (!existsSync(STATE)) return {}
    return JSON.parse(readFileSync(STATE, 'utf8')) || {}
  } catch { return {} }
}

function writeState(o) {
  try {
    mkdirSync(dirname(STATE), { recursive: true })
    writeJsonAtomic(STATE, o)
  } catch {}
}

/** 最新那个 raw 文件的最后 TAIL_BYTES 字节（不整读） */
function tailOfNewestRaw(sea) {
  const dir = join(ROOT, String(sea || 'main'), 'raw')
  if (!existsSync(dir)) return { text: '', file: '', size: 0 }
  let newest = null
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const p = join(dir, f)
    try {
      const st = statSync(p)
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { p, mtimeMs: st.mtimeMs, size: st.size }
    } catch {}
  }
  if (!newest) return { text: '', file: '', size: 0 }
  const start = Math.max(0, newest.size - TAIL_BYTES)
  const len = newest.size - start
  const buf = Buffer.alloc(len)
  const fd = openSync(newest.p, 'r')
  try { readSync(fd, buf, 0, len, start) } finally { closeSync(fd) }
  return { text: buf.toString('utf8'), file: newest.p, size: newest.size }
}

/**
 * 扫一遍。返回 { scanned, created, skipped, why }
 * opt.force 忽略节流与开关（测试用）；opt.turn 当前轮数。
 */
export function maybeHarvest(sea = 'main', opt = {}) {
  let on = false
  try { on = Number(tuning().styleOn) === 1 } catch { on = false }
  if (!on && opt.force !== true) return { scanned: 0, created: 0, skipped: true, why: '开关没开' }

  const turn = Number(opt.turn) || 0
  const st = readState()
  const key = String(sea)
  const cur = st[key] || { cursor: 0, at: 0 }
  if (turn > 0) cur.turns = turn
  const now = Date.now()
  if (!opt.force && now - Number(cur.at || 0) < MIN_GAP) return { scanned: 0, created: 0, skipped: true, why: '刚扫过' }

  const { text, size } = tailOfNewestRaw(sea)
  if (!text) {
    st[key] = { cursor: 0, at: now, turns: Number(cur.turns) || 0 }
    writeState(st)
    return { scanned: 0, created: 0, skipped: false, why: '没有 raw' }
  }

  const lines = text.split('\n').filter(Boolean)
  const msgs = []
  for (const rawLine of lines) {
    const l = rawLine.replace(/^\uFEFF/, '')
    try {
      const o = JSON.parse(l)
      if (o.who !== 'user') continue
      const t = String(o.text || '').replace(/【[\s\S]*?】/g, '').replace(/\n+/g, ' ').trim()
      const n = [...t].length
      if (n < 4 || n > 200) continue
      msgs.push({ text: t, at: Number(o.at) || now })
    } catch {}
  }
  const fresh = msgs.slice(-MAX_MSGS)
  if (!fresh.length) {
    st[key] = { cursor: size, at: now, turns: Number(cur.turns) || 0 }
    writeState(st)
    return { scanned: 0, created: 0, skipped: false, why: '尾部没有用户消息' }
  }

  // 用户当场否定：只处理「刚用过」的，不扫整海
  const DENY = /(别学我|别学这个|不像我|别这么说话|别模仿我)/
  const catFails = { ...(st.catFails || {}) }
  if (fresh.some((e) => DENY.test(e.text))) {
    const turns = Number(cur.turns) || 0
    for (const p of listStyle(sea)) {
      if (p.noLearn === true) continue
      const lastTurn = Number(p.lastUsedTurn) || 0
      const byTurn = turns > 0 && lastTurn > 0 && turns - lastTurn <= 3
      const byTime = p.lastUsedAt && now - Number(p.lastUsedAt) <= 30 * 60 * 1000
      if (!byTurn && !(turns === 0 && byTime)) continue
      const cat = String(p.cat || '其他')
      catFails[cat] = (Number(catFails[cat]) || 0) + 1
    }
    st.catFails = catFails
  }

  const points = listStyle(sea)
  const existing = new Set(points.map((p) => p.styleKey))
  const banned = st.catFails || {}
  const batched = []
  for (const e of fresh) {
    for (const o of observe(e.text, e.at)) {
      if (Number(banned[o.cat]) >= 3) continue
      if (o.cat === '口癖') continue // 口癖自动抽出来全是噪音（tic-按钮、tic-用户），不做
      if (!existing.has(o.key) && points.length + batched.length >= MAX_POINTS) continue
      batched.push({ obs: o, at: e.at, text: e.text })
    }
  }
  const res = batched.length ? upsertMany(sea, batched, { turn, maxNew: MAX_NEW }) : { created: 0 }
  st[key] = { cursor: size, at: now, turns: Number(cur.turns) || 0 }
  writeState(st)
  return { scanned: fresh.length, created: res.created || 0, skipped: false, why: '' }
}

export function scanStatePath() { return STATE }

/** 注入路径自己数轮：turnCount 在注入里常年读 0（文件里写着实测），别借它。 */
export function nextTurn(sid) {
  try {
    if (!globalThis.__dshStyleTurn) globalThis.__dshStyleTurn = new Map()
    const k = String(sid || 'default')
    const v = (globalThis.__dshStyleTurn.get(k) || 0) + 1
    globalThis.__dshStyleTurn.set(k, v)
    return v
  } catch { return 0 }
}
