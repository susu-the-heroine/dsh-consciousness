/**
 * 存储层
 * ======
 *
 * 识海的读写全在这儿：读、写、备份、meta。
 *
 * 原先这些散在 index.js 里，和路由、工具、检索搅在一起。
 * 拆出来之后，"怎么写盘"和"怎么检索"彻底分开了。
 *
 * 写入用 tmp + rename：先写临时文件再原子替换，
 * 中途断电不会留下半个 JSON。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { replaceAll as mirrorReplaceAll } from './sqlite-mirror.js'
import { join, dirname } from 'node:path'
import { audit } from './log.js'
import { BACKUP_DIR, SEAS_DIR } from './paths.js'

/** 一个识海的 data.json 路径 */
export const seaPath = (sea) => join(SEAS_DIR, sea, 'data.json')

/** 读一个识海。读不到返回 null，不抛 */
export function readSea(sea) {
  const p = seaPath(sea)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}


// 镜像（防抖）：写库很频繁（每次被想起都可能改强度），两秒内的多次写合成一次全量镜像。
// 失败只吞掉——JSON 才是权威，绝不因为镜像拖垮写入。
const _mirrorTimers = new Map()
function mirrorSoon(sea, data) {
  try {
    const old = _mirrorTimers.get(sea)
    if (old) clearTimeout(old)
    const points = (data && data.points) || []
    const t = setTimeout(() => {
      _mirrorTimers.delete(sea)
      if (points.length > 5000) return
      try { mirrorReplaceAll(sea, points, (data && data.edges) || []) } catch {}
    }, 2000)
    if (t && typeof t.unref === 'function') t.unref()
    _mirrorTimers.set(sea, t)
  } catch {}
}

/** 写一个识海。原子写：tmp + rename */
export function writeSea(sea, data) {
  mirrorSoon(sea, data)
  const p = seaPath(sea)
  const tmp = p + '.tmp'
  // 缩水拦截：原来一百多条，这次写进去只剩一半以下，多半是读到了空库或写坏了。
  // 宁可拒写、报错、让人来看，也不能静默覆盖。2026-11-10 加。
  try {
    const nowN = Array.isArray(data && data.points) ? data.points.length : 0
    const prevRaw = existsSync(p) ? readFileSync(p, 'utf8') : ''
    if (prevRaw) {
      const prev = JSON.parse(prevRaw.replace(/^\uFEFF/, ''))
      const prevN = Array.isArray(prev && prev.points) ? prev.points.length : 0
      if (prevN >= 20 && nowN * 2 < prevN) {
        try { audit('write-sea-shrink-blocked', { sea, prevN, nowN }) } catch {}
        return false
      }
    }
  } catch {}
  try {
    // 目录不存在就自己建。之前不建，写失败还静默返回 false——
    // 五套新识海第一次全挂在这，查了半天。
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(tmp, JSON.stringify(data), 'utf8')
    renameSync(tmp, p)
    return true
  } catch (e) {
    try { audit('write-sea-fail', { sea, err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return false
  }
}

/** 备份一份。保留 14 天，超期的自动删 */
export function backupSea(sea) {
  try {
    const src = join(SEAS_DIR, sea, 'data.json')
    if (!existsSync(src)) return
    const dir = join(BACKUP_DIR, sea)
    mkdirSync(dir, { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const name =
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      '-' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds()) +
      '.json'
    copyFileSync(src, join(dir, name))
    const cutoff = Date.now() - 14 * 86400000
    for (const f of readdirSync(dir)) {
      const fp = join(dir, f)
      try {
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp)
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 备份失败不能挡住写入 */
  }
}

/** 读 meta。没有就 null */
export function readMeta(sea) {
  try {
    const p = join(SEAS_DIR, sea, 'meta.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 写 meta */
export function writeMeta(sea, meta) {
  try {
    writeFileSync(join(SEAS_DIR, sea, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 识海不存在就建一个。
 * 子智能体实测：写一个没建过的识海，工具直接拒，还留下一个空目录壳。
 * 她本来就该能自己开新的——第一次往里写就是那个意思。
 */
export function ensureSea(id, name) {
  const sid = String(id || '').trim() || 'main'
  const dir = join(SEAS_DIR, sid)
  const file = join(dir, 'data.json')
  if (existsSync(file)) return false
  mkdirSync(dir, { recursive: true })
  const empty = {
    version: 1,
    points: [],
    edges: [],
    stats: { points: 0, edges: 0, kinds: { fact: 0, taboo: 0, feeling: 0 } },
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }
  writeFileSync(file, JSON.stringify(empty), 'utf8')
  try { writeMeta(sid, { name: String(name || sid), createdAt: Date.now() }) } catch {}
  return true
}
