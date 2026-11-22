/**
 * 用"他下一条的反应"给自己改判
 * ==========================
 * 他说「你他妈傻逼吧哈哈」，我判成真扎 → 她委屈。
 * 但如果他下一条还乐呵呵接着聊，那就说明我判错了——这不是要他贴标签，
 * 是他自己下一步的反应就是标签。
 *
 * 规则（能解释、不玄）：
 *   上一条判"真扎" + 这一条没火气（不短、不带脏字、带笑或正常问句） → 改判"是闹"
 *   上一条判"闹"   + 这一条更重（带死亡词/更短/更脏）                 → 改判"真扎"
 * 判错的次数会存下来：错得多，下次判"真扎"就要更强的证据。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-banter.json')

const HOT = /傻|他妈|他吗|操|草|滚|废物|弱智|蠢|狗屎|闭嘴/
const LAUGH = /哈|笑|乐|狗头|233/

function readAll() {
  try {
    if (!existsSync(FILE)) return { mins: {}, wrong: 0, right: 0 }
    return JSON.parse(readFileSync(FILE, 'utf8')) || { mins: {}, wrong: 0, right: 0 }
  } catch { return { mins: {}, wrong: 0, right: 0 } }
}

function writeAll(o) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeJsonAtomic(FILE, o)
  } catch {}
}

/** 这一条还有火气吗 */
export function stillHot(text) {
  const s = String(text || '')
  const n = [...s].length
  const laugh = LAUGH.test(s)
  const hot = HOT.test(s)
  const deadly = /去死|死吧|楼跳|找个楼|滚出去/.test(s)
  // 带笑就不算还有火——除非那句话是要人消失
  if (laugh && !deadly) return false
  // 短、带脏字、没有笑 → 还在火里
  if (hot && n <= 18) return true
  return false
}

/**
 * 拿上一条的判断 + 这一条的话，决定要不要改判。
 * @returns {{corrected:null|'banter'|'serious', why:string}}
 */
export function reconcile(prevVerdict, nextText) {
  const prev = String(prevVerdict || '')
  if (!prev) return { corrected: null, why: '' }
  const hot = stillHot(nextText)
  const laugh = LAUGH.test(String(nextText || ''))

  if (prev === 'serious' && !hot && laugh) {
    return { corrected: 'banter', why: '他下一条还带着笑，上一条不是扎' }
  }
  if (prev === 'banter' && hot) {
    return { corrected: 'serious', why: '他下一条更重，上一条不是闹' }
  }
  // 2026-11-20：头注释写的是「没火气（不短、不带脏字、带笑或正常问句）」才改判，
  // 实现里只看了「没火气」——他骂完一句，下一句平静地说个事，也会被当成玩笑。
  // 按注释补上：得带笑、带问号、或者说了不短的一段，才算翻篇。
  const _s = String(nextText || '')
  if (prev === 'serious' && !hot && (laugh || /[?？]/.test(_s) || [..._s].length > 18)) {
    return { corrected: 'banter', why: '他下一条没火气、还说开了，上一条多半是嘴上损' }
  }
  return { corrected: null, why: '' }
}

/** 记一次观察：prevVerdict 是上一轮判的，nextText 是他刚发的 */
export function observe(sid, prevVerdict, nextText) {
  const r = reconcile(prevVerdict, nextText)
  const all = readAll()
  if (r.corrected) {
    all.wrong = (Number(all.wrong) || 0) + 1
  } else if (prevVerdict) {
    all.right = (Number(all.right) || 0) + 1
  }
  all.mins[String(sid)] = { prev: String(prevVerdict || ''), at: Date.now() }
  writeAll(all)
  return r
}

/** 判"真扎"要不要更硬的证据：错得多了就收紧 */
export function needStrongerEvidence() {
  const all = readAll()
  const wrong = Number(all.wrong) || 0
  const right = Number(all.right) || 0
  const total = wrong + right
  if (total < 6) return false
  return wrong / total > 0.4
}

export function banterProfilePath() { return FILE }

/** 这一轮判了什么，先存着——等他下一句回来对账 */
export function rememberVerdict(sid, verdict) {
  const all = readAll()
  all.pending = all.pending || {}
  all.pending[String(sid)] = { verdict: String(verdict || ''), at: Date.now() }
  writeAll(all)
}

/** 取上一轮存的判断（取了就清，避免错位） */
export function takeVerdict(sid) {
  const all = readAll()
  const cur = all.pending && all.pending[String(sid)]
  if (!cur) return ''
  delete all.pending[String(sid)]
  writeAll(all)
  // 2026-11-20：存着的判断没有保质期。隔了一天半、或者中间崩过一次，
  // 下一句回来还拿旧判断对账——那是拿前天的火气量今天的话。
  if (Date.now() - (Number(cur.at) || 0) > 30 * 60 * 1000) return ''
  return String(cur.verdict || '')
}
