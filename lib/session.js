/**
 * 会话绑定
 * ========
 *
 * 一个窗口绑一个识海。**但一个识海可以被多个窗口认领。**
 *
 * 2026-11-08 改的方向：以前是「海里记窗口」——meta.json 里一个 session 字段，
 * 只能写一个窗口，第二个窗口来认领就把第一个顶掉。
 * 现在反过来：「窗口记海」，存在一张单独的绑定表里，一个海可以出现在多行。
 *
 * 老数据不清：meta.session 还留着（页面显示"这个海归哪个窗口"用），
 * 但判断归属时以绑定表为准；绑定表里没有的，才回退去看 meta.session。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { SEAS_DIR } from './paths.js'
import { readMeta, writeMeta } from './store.js'

const BINDINGS = join(dirname(SEAS_DIR), 'consciousness-bindings.json')

let _cache = null
let _cacheAt = 0
let _cacheMtime = 0

function readBindings() {
  try {
    const mt = existsSync(BINDINGS) ? statSync(BINDINGS).mtimeMs : 0
    if (_cache && mt === _cacheMtime && Date.now() - _cacheAt < 5000) return _cache
    if (!existsSync(BINDINGS)) {
      _cache = { v: 1, bySid: {} }
    } else {
      const o = JSON.parse(readFileSync(BINDINGS, 'utf8'))
      _cache = o && o.bySid ? { v: 1, bySid: o.bySid } : { v: 1, bySid: {} }
    }
    _cacheAt = Date.now()
    _cacheMtime = mt
  } catch {
    _cache = { v: 1, bySid: {} }
    _cacheAt = Date.now()
  }
  return _cache
}

const PRUNE_DAYS = 30

function writeBindings(obj) {
  // 顺手清掉太久没动的窗口：测试每跑一轮会留二十几个假 sid，
  // 不清的话这张表会越积越长。
  try {
    const cut = Date.now() - PRUNE_DAYS * 86400000
    for (const [sid, v] of Object.entries(obj.bySid || {})) {
      if (!v || Number(v.at || 0) < cut) delete obj.bySid[sid]
    }
  } catch {}
  try {
    mkdirSync(dirname(BINDINGS), { recursive: true })
    writeFileSync(BINDINGS, JSON.stringify(obj, null, 1), 'utf8')
    _cache = obj
    _cacheAt = Date.now()
    try { _cacheMtime = statSync(BINDINGS).mtimeMs } catch {}
  } catch {}
}

/** 兼容老数据：老版本只把窗口写在 meta.session 里 */
function legacySeaOf(sid) {
  try {
    for (const name of readdirSync(SEAS_DIR)) {
      const m = readMeta(name)
      if (m && String(m.session || '') === String(sid)) return name
    }
  } catch {}
  return ''
}

/** 哪个识海已经认了这个窗口（没认过返回空） */
export function seaForSession(sid) {
  if (!sid) return ''
  const b = readBindings()
  const hit = b.bySid[String(sid)]
  if (hit && hit.sea) return String(hit.sea)
  return legacySeaOf(sid)
}

/** 认领：把一个窗口钉到某个识海。一个海可以有很多窗口。 */
export function bindSession(sea, sid) {
  if (!sid || !sea) return
  const b = readBindings()
  const key = String(sid)
  const cur = b.bySid[key]
  if (cur && cur.sea === String(sea)) return
  b.bySid[key] = { sea: String(sea), at: Date.now() }
  writeBindings(b)
  // meta.session 只用来在页面上显示"最近一个认领的窗口"，不再参与判断。
  // 第二个窗口来的时候不覆盖它——覆盖会让页面上的归属看着乱。
  try {
    const m = readMeta(sea)
    if (m && !m.session) {
      m.session = key
      writeMeta(sea, m)
    }
  } catch {}
}

/** 这个窗口该用哪个海（没有就用 main） */
export function seaOfSession(sid) {
  if (!sid) return 'main'
  return seaForSession(sid) || 'main'
}

/** 这个海被哪些窗口认领了（给页面显示用） */
export function sessionsOfSea(sea) {
  const b = readBindings()
  const out = []
  for (const [sid, v] of Object.entries(b.bySid || {})) {
    if (v && String(v.sea) === String(sea)) out.push(sid)
  }
  return out
}

/** 解绑：窗口删了或者搬家时用 */
export function unbindSession(sid) {
  if (!sid) return
  const b = readBindings()
  if (b.bySid && b.bySid[String(sid)]) {
    delete b.bySid[String(sid)]
    writeBindings(b)
  }
}
