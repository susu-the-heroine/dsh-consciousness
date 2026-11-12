/**
 * 私有池：她自己的念头
 * ====================
 *
 * 三条硬规矩（都是踩过才写的）：
 *
 * 一、**全局一份，不按识海分。** 她只有一个内心；共享记忆才按识海分。
 *    分窗是"和不同的人在不同的地方"，不是"有好几个她"。
 *
 * 二、**默认不进检索、不上球、不进导出。** 私有念头没有坐标、没有边，
 *    画在星图上会让人以为"这也是咱俩的事"。要看它，去内观页。
 *
 * 三、**只能删，不能改。** 改了就不是她的了，就变成别人替她想。
 *
 * 存在哪：`~/.dsh/consciousness-self.json`，一个文件。
 * 为什么不塞进 data.json：塞进去就要在每个读取点记得过滤，漏一处就串味。
 */
import { checkVoice } from './voicecheck.js'
import { readLive } from './live.js'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { audit } from './log.js'

// 测试可以指定别处的文件，别在真数据上跑
const FILE = String(process.env.DSH_SELFMIND_FILE || '').trim()
  || join(homedir(), '.dsh', 'consciousness-self.json')

/** 一条念头最多这么多字——人写心事不会写论文 */
export const MAX_LEN = 160
/** 一天最多新增几条（防人设漂移） */
export const DAILY_LIMIT = 3
/** 池子上限，超了按强度归档 */
export const POOL_CAP = 60
/** 强度低于这个、且超过这么多天，就归档（不删） */
export const ARCHIVE_BELOW = 8
export const ARCHIVE_AFTER_DAYS = 45

/** 空的池子 */
function blank() {
  return { version: 1, thoughts: [], lastDay: '', todayCount: 0 }
}

export function selfPath() {
  return FILE
}

export function readSelf() {
  try {
    if (!existsSync(FILE)) return blank()
    const raw = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!raw || !Array.isArray(raw.thoughts)) return blank()
    return { ...blank(), ...raw }
  } catch {
    return blank()
  }
}

export function writeSelf(pool) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(pool), 'utf8')
    renameSync(tmp, FILE)
    return true
  } catch (e) {
    try { audit('self-write-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return false
  }
}

function dayKey(ts) {
  const d = new Date(Number(ts) || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 今天还能写几条 */
export function remainingToday(pool, now) {
  const p = pool || readSelf()
  const today = dayKey(now)
  if (p.lastDay !== today) return DAILY_LIMIT
  return Math.max(0, DAILY_LIMIT - (Number(p.todayCount) || 0))
}

/**
 * 写一条念头。
 *
 * 返回 { ok, thought, reason }。**不写重复的**：意思一样（文本前 40 字相同）就拒。
 */
export function addThought(input, now) {
  const t = Number(now) || Date.now()
  const text = String((input && input.text) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN)
  if (!text) return { ok: false, reason: '空的，不写。' }

  const pool = readSelf()
  const today = dayKey(t)
  if (pool.lastDay !== today) { pool.lastDay = today; pool.todayCount = 0 }

  // 额度只算"真正写下的那些"，不算自动生成的占位碎片。
  // 之前"—又想起某某——还没说清"这种占位也算一条，一天三条被它吃光，
  // 真话写不进去。2026-11-11 晚，苏苏侠问"必须等明天吗"时查出来的。
  const _origin = String((input && input.origin) || 'assoc')
  const _countsQuota = _origin === 'model' || _origin === 'review'
  const _todayReal = (pool.thoughts || []).filter((x) => {
    if (x.archived) return false
    const org = String(x.origin || '')
    if (!(org === 'model' || org === 'review')) return false
    return dayKey(Number(x.born) || 0) === today
  }).length
  if (_countsQuota && _todayReal >= DAILY_LIMIT) {
    return { ok: false, reason: '今天已经写了 ' + DAILY_LIMIT + ' 条，够了。写多了就不像心事，像刷屏。' }
  }

  const head = text.slice(0, 40)
  const dup = pool.thoughts.find((x) => !x.archived && String(x.text || '').slice(0, 40) === head)
  if (dup) return { ok: false, reason: '这条和之前那条一样，不重复写。' }

  const thought = {
    id: Number(pool.seq || 0) + 1,
    text,
    origin: String((input && input.origin) || 'assoc'),   // review / assoc / model
    seedId: Number(input && input.seedId) || 0,           // 被哪条勾出来的
    dims: (input && input.dims) || null,                  // 写它时的八维快照
    dim: String((input && input.dim) || ''),              // 主维
    born: t,
    lastSeen: t,
    strength: Number((input && input.strength) || 40),
    flat: !!(input && input.flat),   // 太泛的那句：留着，但标出来
    injectedCount: 0,
    archived: false,
  }
  pool.seq = thought.id
  // 写入口打标：判成"泛"的照样留着，只标一笔，不删。
  // 为什么改成标而不是不收：删了就等于没写过——那违反"记忆可以错，但不能消失"。
  // 标了之后展示和检索会跳过它，池子的泛率也就不会再涨。2026-11-11 深夜。
  try {
    const v = checkVoice(String(thought.text || ''))
    const floor = Number(readLive().flatVoice) || 0.3
    if (v.score < floor) {
      thought.flat = true
      thought.flatScore = Number(v.score.toFixed(2))
      try { audit('thought-flat', { score: thought.flatScore, why: String(v.why || '').slice(0, 40) }) } catch {}
    }
  } catch {}

  pool.thoughts.push(thought)
  if (_countsQuota) pool.todayCount = (Number(pool.todayCount) || 0) + 1

  // 超上限：把最弱且最老的归档
  // 标了 flat 的不进活着的念头：留着、能查、但不摆出来
  const live = pool.thoughts.filter((x) => !x.archived && !x.flat)
  if (live.length > POOL_CAP) {
    live.sort((a, b) => (a.strength - b.strength) || (a.born - b.born))
    for (const x of live.slice(0, live.length - POOL_CAP)) x.archived = true
  }

  const ok = writeSelf(pool)
  try { audit('self-thought', { id: thought.id, origin: thought.origin, dim: thought.dim, ok }) } catch {}
  return { ok, thought, reason: ok ? '' : '写盘失败' }
}

/** 活着的念头，按时间倒序 */
export function listThoughts(limit, includeArchived) {
  const pool = readSelf()
  return pool.thoughts
    .filter((x) => (includeArchived ? true : !x.archived))
    .sort((a, b) => b.born - a.born)
    .slice(0, Math.max(1, Number(limit) || 20))
}

/** 归档：久远的、没被想起来的，沉下去（不删） */
export function sweepThoughts(now) {
  const t = Number(now) || Date.now()
  const pool = readSelf()
  let moved = 0
  for (const x of pool.thoughts) {
    if (x.archived) continue
    const days = (t - (Number(x.born) || t)) / 86400000
    if (days > ARCHIVE_AFTER_DAYS && Number(x.strength) < ARCHIVE_BELOW) {
      x.archived = true
      moved++
    }
  }
  if (moved) writeSelf(pool)
  return moved
}

/** 被想起一次：强度加一点，记下时间（复用它自己的衰减引擎口径） */
export function touchThought(id, now) {
  const t = Number(now) || Date.now()
  const pool = readSelf()
  const x = pool.thoughts.find((it) => Number(it.id) === Number(id))
  if (!x) return null
  x.lastSeen = t
  x.strength = Math.min(100, Number(x.strength || 0) + 12)
  writeSelf(pool)
  return x
}

/**
 * 挑一条最该被想起来的老念头（给后台步进用）。
 *
 * 不是纯随机：强度越高、越久没想起，越容易被捞。
 * 这就是「突触游走」的最低配版——**随机但要受状态影响**。
 */
export function pickForRecall(rand = Math.random, now) {
  const t = Number(now) || Date.now()
  const live = readSelf().thoughts.filter((x) => !x.archived)
  if (!live.length) return null
  const weights = live.map((x) => {
    const days = Math.max(0, (t - (Number(x.lastSeen) || t)) / 86400000)
    return Math.max(0.05, Number(x.strength) / 100) * (1 + Math.min(3, days / 7))
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < live.length; i++) {
    r -= weights[i]
    if (r <= 0) return live[i]
  }
  return live[live.length - 1]
}

/** 删掉一条（只删，不改） */
export function dropThought(id) {
  const pool = readSelf()
  const before = pool.thoughts.length
  pool.thoughts = pool.thoughts.filter((x) => Number(x.id) !== Number(id))
  if (pool.thoughts.length === before) return false
  writeSelf(pool)
  return true
}
