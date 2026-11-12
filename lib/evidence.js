/**
 * 证据层
 * ======
 *
 * 每轮对话原文按天落 raw/YYYY-MM-DD.jsonl，一行一条，只追加不修改。
 * 记忆里的 evidence 是 {file, line, quote}——指向原文，不复制。
 *
 * 为什么：之前 evidence 是写入那一刻从 text 抄的副本，不在可追溯链上。
 * 记歪了查不到原文，说错话拿不出「在第几行」。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SEAS_DIR } from './paths.js'
import { mask } from './privacy.js'

export function rawDir(sea) {
  return join(SEAS_DIR, sea, 'raw')
}

export function rawFileFor(sea, ts) {
  const d = new Date(ts || Date.now())
  const pad = (n) => String(n).padStart(2, '0')
  const name = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.jsonl'
  return { dir: rawDir(sea), name, path: join(rawDir(sea), name) }
}

/**
 * 一行原文的指纹。
 *
 * 哈希不是防破解——文件在本地，谁都改得动。
 * 它防的是「悄悄改」：删一行、换顺序、改一个字，链就断在这一行。
 * 每行还记着上一行的哈希（prev），所以断哪儿一目了然。
 */
function hashOf(prev, at, who, text) {
  return createHash('sha256')
    .update(String(prev || '') + '|' + String(at) + '|' + String(who) + '|' + String(text))
    .digest('hex')
    .slice(0, 32)
}

/** 读一整个文件，按行拆（去掉空行） */
function readLines(path) {
  const out = []
  try {
    const cur = readFileSync(path, 'utf8')
    for (const ln of cur.split('\n')) {
      const s = ln.trim()
      if (s) out.push(s)
    }
  } catch {}
  return out
}

/** 这一行上一行的哈希（没有就是空） */
function lastHashOf(path) {
  const lines = readLines(path)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i])
      if (j && j.hash) return String(j.hash)
    } catch {}
  }
  return ''
}

/** 追加一行原文。返回 {file, line} 供 evidence 指向。 */
export function appendRaw(sea, who, text, ts) {
  // 原话照记，但证件号、密钥这类换成稳定 token——事实留着，号码没有
  const s = mask(String(text || '').trim())
  if (!s) return null
  const now = ts || Date.now()
  const f = rawFileFor(sea, now)
  try {
    mkdirSync(f.dir, { recursive: true })
    // 数一下现在有几行，用来定位
    let line = 0
    if (existsSync(f.path)) {
      const cur = readFileSync(f.path, 'utf8')
      line = cur.split('\n').filter(Boolean).length
    }
    const prev = lastHashOf(f.path)
    const w = String(who || 'user')
    const hash = hashOf(prev, now, w, s)
    const rec = JSON.stringify({ at: now, who: w, text: s, prev, hash }) + '\n'
    appendFileSync(f.path, rec, 'utf8')
    return { file: f.name, line: line + 1, quote: s.slice(0, 200) }
  } catch {
    return null
  }
}

/** 从证据指针里把原话取回来。 */
export function readRaw(sea, ref) {
  if (!ref || !ref.file) return null
  try {
    const path = join(rawDir(sea), String(ref.file))
    if (!existsSync(path)) return null
    const lines = readFileSync(path, 'utf8').split('\n')
    const ln = lines[Number(ref.line) - 1]
    if (!ln) return null
    return JSON.parse(ln)
  } catch {
    return null
  }
}

/**
 * 查一遍链有没有断。
 *
 * 三种问题分开报，因为它们的意思完全不同：
 *   broken_chain      上一行的哈希对不上——中间被删了行，或者顺序被换了
 *   content_mismatch  这一行内容跟自己的哈希对不上——被改过字
 *   no_prev           有哈希但没接上上一行（多半是从别处复制来的半截文件）
 *
 * 老行没有 hash 字段，直接跳过并计数，不用迁移。
 */
export function verifyRaw(sea, only) {
  const dir = rawDir(sea)
  const out = { ok: true, files: 0, lines: 0, hashed: 0, legacy: 0, problems: [] }
  try {
    if (!existsSync(dir)) return out
    let files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
    if (only) files = files.filter((f) => f === only)
    out.files = files.length
    for (const f of files) {
      const path = join(dir, f)
      const lines = readLines(path)
      let prevHash = ''
      for (let i = 0; i < lines.length; i++) {
        out.lines++
        let j = null
        try { j = JSON.parse(lines[i]) } catch {
          out.problems.push({ file: f, line: i + 1, problem: 'bad_json' })
          out.ok = false
          continue
        }
        if (!j || !j.hash) { out.legacy++; continue }   // 老行：没链接，不计入
        out.hashed++
        const want = hashOf(j.prev, j.at, j.who, j.text)
        if (want !== String(j.hash)) {
          out.problems.push({ file: f, line: i + 1, problem: 'content_mismatch' })
          out.ok = false
        }
        if (String(j.prev || '') !== prevHash) {
          out.problems.push({ file: f, line: i + 1, problem: 'broken_chain' })
          out.ok = false
        }
        prevHash = String(j.hash)
      }
    }
  } catch (e) {
    out.ok = false
    out.error = String((e && e.message) || e)
  }
  return out
}

/** 统计证据层：多少天、多少行、覆盖了哪些记忆 */
export function rawStats(sea) {
  const dir = rawDir(sea)
  try {
    if (!existsSync(dir)) return { days: 0, lines: 0, bytes: 0, files: [] }
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    let lines = 0
    let bytes = 0
    for (const f of files) {
      const p2 = join(dir, f)
      const st = statSync(p2)
      bytes += st.size
      lines += readFileSync(p2, 'utf8').split('\n').filter(Boolean).length
    }
    return { days: files.length, lines, bytes, files: files.sort() }
  } catch {
    return { days: 0, lines: 0, bytes: 0, files: [] }
  }
}
