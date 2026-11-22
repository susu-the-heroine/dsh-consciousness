/**
 * 有上限的追加日志
 * ================
 *
 * 日志是给人和模型看的，不是给磁盘堆的。无上限的日志跑几个月能到几百兆，
 * 到时候不光占地方，读起来也慢——而没人会每天去删。
 *
 * 做法：追加之后看大小；超上限就把"最近的半截"留成 .1，主文件截断成那半截。
 * 只留两档（当前 + .1），最多占 1.5 倍上限，不搞 .1 .2 .3 那一串。
 */
import { appendFileSync, existsSync, readFileSync, openSync, readSync, closeSync, renameSync, statSync, truncateSync, writeFileSync } from 'node:fs'

export const LOG_MAX = 2 * 1024 * 1024

export function appendBounded(file, text, maxBytes = LOG_MAX) {
  try {
    appendFileSync(file, text, 'utf8')
    if (statSync(file).size <= maxBytes) return { rotated: false }
    const keep = Math.floor(maxBytes / 2)
    // 2026-11-20：原来是按字切——keep 是字节数，slice 按的是字符数。中文一个字三字节，
    // 于是「留一半」实际只留了六分之一。改成按字节取尾巴再解码。
    const buf = readFileSync(file)
    const tail = buf.subarray(Math.max(0, buf.length - keep)).toString('utf8')
    // 从下一个换行开始，别把一行 JSON 切成两半——切过的日志读出来是坏数据
    const nl = tail.indexOf('\n')
    const body = nl >= 0 ? tail.slice(nl + 1) : tail
    try { writeFileSync(file + '.1', body, 'utf8') } catch {}
    truncateSync(file, 0)
    appendFileSync(file, body, 'utf8')
    return { rotated: true }
  } catch {
    return { rotated: false }
  }
}

/**
 * 只读最后一行（日志再大也只读尾巴）
 * ----------------------------------
 * 每轮注入都要拿"上一轮写了哪几条"来比对，整份读是浪费——两兆的日志，
 * 一次读进来只为了看最后一行。这里只读末尾 8KB，取最后一整行。
 * 返回解析后的对象；文件不存在、读不懂、没有整行，都返回 null。
 */
export function readLastLine(file, tailBytes = 8192) {
  try {
    const size = statSync(file).size
    if (!size) return null
    const len = Math.min(tailBytes, size)
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(len)
    try { readSync(fd, buf, 0, len, size - len) } finally { closeSync(fd) }
    const text = buf.toString('utf8').trimEnd()
    const nl = text.lastIndexOf('\n')
    const line = nl >= 0 ? text.slice(nl + 1) : text
    if (!line) return null
    return JSON.parse(line)
  } catch { return null }
}
