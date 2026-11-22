/**
 * 存储 · JS 版（锁 + 原子写 + 备份）
 * ================================
 *
 * 跟 add_memory.py 的行为对齐，逐条都有出处：
 *   锁：sea 目录下 data.json.lock，内容是 {at, pid}，60 秒算过期，最多等 3 秒（2026-11-15 改：原本 120 秒，页面会白转两分钟）。
 *       ——两边必须用同一把锁，否则导入和聊天同时写照样撞。
 *   写：先写 data.json.tmp、fsync、再 rename 覆盖。直接覆盖的话，写到一半断电就是半个 JSON。
 *   备：写之前拷一份到 backups/<sea>/<时间>.json，只留最近 14 天。
 *   meta：写完更新 meta.json 的 count 与 mtime。
 */
import { replaceAll as mirrorReplaceAll } from './sqlite-mirror.js'
import { audit } from './log.js'
import { existsSync, linkSync, mkdirSync, openSync, writeSync, closeSync, fsyncSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
// 2026-11-20：这里原来直接拿系统用户目录，跟别处那套「家目录可被环境变量顶掉」不一路——
// 跑测试只改家目录时，这一版仍会写到真库。统一从 paths 拿。
import { HOME } from './paths.js'

const SEAS = join(HOME, '.dsh', 'consciousness-seas')
const BACKUP = join(HOME, '.dsh', 'consciousness-backups')

export const LOCK_TTL_MS = 60 * 1000
// 2026-11-15：原本等 120 秒，页面点一下要转两分钟才报错，人只会以为卡死。
// 改成跟主路一样等 3 秒，拿不到就明说"正在被另一个操作占着"，别让人干等。
const LOCK_WAIT_MS = 3 * 1000
const KEEP_DAYS = 14

export function seaDir(sea = 'main') {
  return join(SEAS, sea)
}

// 2026-11-19：原来是空转等（while + Date.now），抢不到锁时把 CPU 烧满，
// 还会把同进程里别的活一起饿着。锁必须同步，所以用 Atomics.wait 真睡——
// 语义没变（到点就返回），但不占 CPU；不支持 Atomics 的运行时退回空转。
const _sleepBuf = new Int32Array(new SharedArrayBuffer(4))
function sleep(ms) {
  const t = Math.max(0, Math.floor(ms))
  if (!t) return
  try {
    Atomics.wait(_sleepBuf, 0, 0, t)
  } catch {
    const end = Date.now() + t
    while (Date.now() < end) { /* 兜底 */ }
  }
}

/**
 * 抢锁。抢到返回 true，等超时返回 false（调用方必须当作失败处理，不能硬写）。
 * 过期判据：锁文件里的 at 超过 60 秒，或者文件本身 60 秒没动。
 */
export function lockSea(sea = 'main') {
  const dir = seaDir(sea)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'data.json.lock')
  const deadline = Date.now() + LOCK_WAIT_MS
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    // 两步走：先把"谁、什么时候"写进一个唯一临时文件，再用硬链接挂到锁名上。
    // 为什么不用 open('wx') 再写内容：那中间有一瞬文件是空的，别的进程读到空文件
    // 会当成"过期锁"删掉，于是两个进程同时持锁——2026-11-12 压测就是这么丢条的。
    const tmp = join(dir, `.lock-${process.pid}-${Date.now()}-${attempt}`)

    // DSH_LOCK_MODE=create：强制走"独占创建"那条退路。
    // 给不支持硬链接的盘用，也用来量退路的代价。2026-11-12
    if (process.env.DSH_LOCK_MODE === 'create') {
      try {
        const fd = openSync(path, 'wx')
        writeSync(fd, JSON.stringify({ at: Date.now(), pid: process.pid }))
        closeSync(fd)
        return { ok: true, path, via: 'create' }
      } catch (e3) {
        if (!e3 || e3.code !== 'EEXIST') return { ok: false, path, err: '锁创建失败：' + String((e3 && e3.message) || e3) }
        let staleC = false
        let deadHolder = false
        try {
          const info = JSON.parse(readFileSync(path, 'utf8'))
          const at = Number(info.at || 0)
          staleC = at > 0 ? Date.now() - at > LOCK_TTL_MS : false
          // 主人已经不在（进程崩了）：立刻清锁，别让网页那边白等到超时。
          // 判据是锁里的 pid；读不出或没 pid，就按"还活着"处理，不乱动。2026-11-15
          const pid = Number(info && info.pid) || 0
          if (pid > 0) {
            let alive = true
            try { process.kill(pid, 0) } catch (e4) { if (e4 && e4.code === 'ESRCH') alive = false }
            if (!alive) { staleC = true; deadHolder = true }
          }
        } catch { try { staleC = Date.now() - statSync(path).mtimeMs > LOCK_TTL_MS } catch {} }
        // 2026-11-21 十六点十三：这一层也会把「刚立、只活了几十毫秒」的锁当陈锁拆掉——
        // 主海那条 14 毫秒就是它干的。两秒以内的锁只等不拆；只有「锁里那个进程已经死了」才立刻清。
        let _age2 = 0
        try { _age2 = Date.now() - statSync(path).mtimeMs } catch { _age2 = 0 }
        if (deadHolder || (staleC && _age2 >= 2000)) { try { unlinkSync(path) } catch {}; continue }
        sleep(20 + (attempt % 5) * 10)
        continue
      }
    }
    try {
      writeFileSync(tmp, JSON.stringify({ at: Date.now(), pid: process.pid }), 'utf8')
      linkSync(tmp, path)
        globalThis.__C2_WRITING__ = Number(globalThis.__C2_WRITING__ || 0) + 1          // 目标已存在会抛错，这就是原子性所在
      try { unlinkSync(tmp) } catch {}
      return { ok: true, path }
    } catch (e) {
      const code = e && e.code

      // 有些盘不支持硬链接（FAT、部分网络盘、某些挂载的移动硬盘）。
      // 那种情况下 linkSync 会报 EPERM/ENOSYS/EXDEV/ENOTSUP——这时退回"独占创建"，
      // 虽有一瞬空文件的窗口，但总比写不进去强。2026-11-12：不补这条，别人装到不支持的盘上会写不进去。
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'EXDEV' || code === 'ENOTSUP' || code === 'EACCES') {
        try {
          const fd = openSync(path, 'wx')
          writeSync(fd, JSON.stringify({ at: Date.now(), pid: process.pid }))
          closeSync(fd)
          try { unlinkSync(tmp) } catch {}
          return { ok: true, path, via: 'create' }
        } catch (e2) {
          try { unlinkSync(tmp) } catch {}
          if (!e2 || e2.code !== 'EEXIST') {
            return { ok: false, path, err: '锁创建失败：' + String((e2 && e2.message) || e2) }
          }
          // 落到下面的"锁在"处理
        }
      } else if (code !== 'EEXIST') {
        try { unlinkSync(tmp) } catch {}
        return { ok: false, path, err: String((e && e.message) || e) }
      }
      try { unlinkSync(tmp) } catch {}
      // 锁在。看看是不是过期了（对方写了一半就死了）
      let stale = false
      try {
        const info = JSON.parse(readFileSync(path, 'utf8'))
        const at = Number(info.at || 0)
        stale = at > 0 ? Date.now() - at > LOCK_TTL_MS : false
        // 主人已经不在：立刻当过期处理。Windows 上目标存在时 linkSync 常抛 EPERM，
        // 会走到这条兜底分支——这里不判死主，网页那边就得白等满 60 秒。2026-11-15
        const pid = Number(info && info.pid) || 0
        if (pid > 0) {
          let alive = true
          try { process.kill(pid, 0) } catch (e5) { if (e5 && e5.code === 'ESRCH') alive = false }
          if (!alive) stale = true
        }
      } catch {
        // 读不懂就不要抢——原来是按 mtime 判过期，会把刚建好的锁误删
        try { stale = Date.now() - statSync(path).mtimeMs > LOCK_TTL_MS } catch {}
      }
      if (stale) {
        try { unlinkSync(path) } catch {}
        continue
      }
      sleep(20 + (attempt % 5) * 10)
    }
  }
  // 等人话：别让调用方拿到一个光秃秃的英文单词就往页面上摆
  return {
    ok: false,
    path,
    err: `这边正被另一个操作占着（等了 ${Math.round(LOCK_WAIT_MS / 1000)} 秒），稍等一下再点一次`,
    code: 'lock-busy',
  }
}

export function unlockSea(lock) {
  if (!lock || !lock.path) return
  // 2026-11-21：这里原来是一声不吭的一次性 unlink——Windows 上删不干净就永久留锁，
  // 下一个写的人只能等过期，审计里那串「自己的锁过期」有一半是它留下的。
  // 现在重试三次，三次都不行记一笔，别再把失败吞了。
  // Windows 上杀毒/索引器会短暂占住文件，20 毫秒三次不够。改成 10 次、间隔从 20 到 200 毫秒（合计约 1 秒）。
  let lastErr = null
  for (let i = 0; i < 10; i++) {
    try {
      unlinkSync(lock.path)
    globalThis.__C2_WRITING__ = Math.max(0, Number(globalThis.__C2_WRITING__ || 0) - 1)
      try { audit('write-lock-released', { sea: String(lock.sea || '') }) } catch {}
      return
    } catch (e) {
      lastErr = e
      try { sleep(20 + i * 20) } catch {}
    }
  }
  try { audit('write-lock-release-failed', { sea: String(lock.sea || ''), err: String((lastErr && lastErr.message) || lastErr).slice(0, 120) }) } catch {}
}

/** 写之前留一份，只留最近 14 天 */
export function backupSea(sea = 'main') {
  const src = join(seaDir(sea), 'data.json')
  if (!existsSync(src)) return null
  try {
    const d = join(BACKUP, sea)
    mkdirSync(d, { recursive: true })
    const stamp = new Date()
    const name = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
      + `-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}.json`
    // 2026-11-20：文件名精确到秒。同一秒里写两次，第二份会把第一份盖掉——
    // 连着改两下，前一步的备份就没了，正好是回滚最需要的那一步。撞名就加序号。
    let dst = join(d, name)
    for (let i = 2; existsSync(dst) && i < 100; i++) {
      dst = join(d, name.replace(/\.json$/, '-' + i + '.json'))
    }
    copyFileSync(src, dst)
    const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000
    for (const f of readdirSync(d)) {
      const fp = join(d, f)
      try { if (statSync(fp).isFile() && statSync(fp).mtimeMs < cutoff) unlinkSync(fp) } catch {}
    }
    return dst
  } catch {
    return null
  }
}

/**
 * 原子写：tmp → fsync → rename；写完更新 meta；最后放锁。
 * 任何一步抛错都会放锁，不把锁留在盘上。
 */

// 镜像（防抖）：写库很频繁（每 2 秒心跳、每次检索都可能改强度），
// 一条条镜像太碎。这里两秒内的多次写合成一次全量镜像。
// 失败只吞掉——JSON 才是权威，绝不因为镜像拖垮写入。
const _mirrorTimers = new Map()
// 2026-11-21：同旧存储层那个毛病——去抖定时器带 unref，进程提前退出就不冲洗，
// JSON 与镜像会差一行。补一个退出前冲洗（和新层同一个口径）。
const _pendingMirror = new Map()
let _flushHooked = false
function _flushMirrors() {
  for (const [sea, v] of _pendingMirror) {
    try {
      const mr = mirrorReplaceAll(sea, v.points, v.edges)
      if (mr && mr.ok === false) {
        try { audit('mirror-deferred-failed', { sea, err: String(mr.err || '没写进去').slice(0, 120) }) } catch {}
      }
    } catch (e) {
      try { audit('mirror-deferred-failed', { sea, err: String((e && e.message) || e).slice(0, 120) }) } catch {}
    }
  }
  _pendingMirror.clear()
}
function _hookFlush() {
  if (_flushHooked) return
  _flushHooked = true
  try { process.on('exit', _flushMirrors) } catch {}
  try { process.on('beforeExit', _flushMirrors) } catch {}
}


function mirrorSoon(sea, data) {
  try {
    const old = _mirrorTimers.get(sea)
    if (old) clearTimeout(old)
    // 全量重写镜像：小库很便宜，大库会成灾。超过五千条就不自动镜像了——
    // 那时候该用显式重建（脚本），不该在两秒一次的写路径里塞几万行。
    const points = (data && data.points) || []
    _hookFlush()
    _pendingMirror.set(sea, { points, edges: (data && data.edges) || [] })
    const t = setTimeout(() => {
      _mirrorTimers.delete(sea)
      _pendingMirror.delete(sea)
      if (points.length > 5000) return
      try {
        // 2026-11-21：这函数不抛错，失败是「返回 ok:false」。原来既不看返回值、
        // 外面又只有个空 catch，等于镜像写没写成都当没看见。
        // 实测：把镜像路径换成目录逼它失败，JSON 照写、审计一条没有——就是这么漏的。
        const mr = mirrorReplaceAll(sea, points, (data && data.edges) || [])
        if (mr && mr.ok === false) {
          try { audit('mirror-deferred-failed', { sea, err: String(mr.err || '没写进去').slice(0, 120) }) } catch {}
        }
      } catch (e) {
        try { audit('mirror-deferred-failed', { sea, err: String((e && e.message) || e).slice(0, 120) }) } catch {}
      }
    }, 2000)
    if (t && typeof t.unref === 'function') t.unref()
    _mirrorTimers.set(sea, t)
  } catch {}
}

// 2026-11-21：写盘口把关——不许把「没有 id」的条目写进盘。
// 实测：往空海写一条不带 id 的，返回成功，盘上 id 落成 null；
// 之后一致性比对里 Number(null)=0，一条脏数据能把整个海判成不一致。
const _idOK = (v) => (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))

export function writeSea(sea, data, lock) {
  const _pts0 = Array.isArray(data && data.points) ? data.points : []
  const _bad = _pts0.filter((p) => !p || !_idOK(p.id))
  if (_bad.length) {
    const eg = _bad.slice(0, 3).map((p) => String((p && p.title) || '(没标题)').slice(0, 16)).join('/')
    // 2026-11-21：拦下来只是止血。谁写进来的、写的是什么，得留下名字——
    // 不然下次再冒一条无 id，还是只能干瞪眼。
    try { audit('write-sea-no-id-blocked', { sea, n: _bad.length, titles: String(eg).slice(0, 120) }) } catch {}
    return { ok: false, err: `有 ${_bad.length} 条没有可用 id（如：${eg}）—— 少了名字的那些，以后翻起来会对不上，先补上再写` }
  }
  const dir = seaDir(sea)
  mkdirSync(dir, { recursive: true })
  const real = join(dir, 'data.json')
  // 缩水拦截（窄版）：只拦"读坏了当空库"那种灾难，不拦正常删条。
  // 2026-11-14 审计：readSea 读坏返回 null → 调用方以空库起手造 1 条 → 这里没闸 →
  // 两百多条直接变一条。所以只在"原来很多、这次几乎没了"时拒写。
  try {
    const nowN = Array.isArray(data && data.points) ? data.points.length : 0
    if (existsSync(real) && nowN <= 2) {
      let prev
      try {
        prev = JSON.parse(readFileSync(real, 'utf8').replace(/^\uFEFF/, ''))
      } catch {
        // 2026-11-21：盘上那份读不出来（被截断、写坏了）——原来的缩水闸在这儿被自己绊倒：
        // 解析一抛就被外面那个空 catch 吞掉，闸没起作用，接着按「空库」写下去。
        // 实测：三十条的库被截断成坏 JSON，写一条进去，盘上变成一条——正是这闸想拦的灾难。
        // 读不出来就不写，把锁还回去，让人自己去修或从备份捞。
        try { audit('write-corrupt-blocked', { sea, nowN }) } catch {}
        try { unlockSea(lock) } catch {}
        return { ok: false, err: '拒写：盘上那份读不出来（可能坏了），没动它' }
      }
      const prevN = Array.isArray(prev && prev.points) ? prev.points.length : 0
      if (prevN >= 20) {
        try { audit('write-shrink-blocked', { sea, prevN, nowN }) } catch {}
        // 2026-11-20：这条拒写是在「拿锁之后」返回的，可放锁在下面那个 finally 里——
        // 一拒写就带着锁返回，下一次写要白等满三秒才被拒。拒之前必须先把锁还回去。
        // 顺带：镜像也不该排了——数据没落盘，镜像先动就成了两份不一样的东西。
        try { unlockSea(lock) } catch {}
        return { ok: false, err: `拒写：原来 ${prevN} 条，这次只 ${nowN} 条，像是读到了坏库` }
      }
    }
  } catch {}
  const tmp = real + '.tmp'
  // 过了缩水闸才排镜像：没落盘就不该先改镜像。
  mirrorSoon(sea, data)
  try {
    backupSea(sea)
    // 2026-11-21：改名那一步失败（库文件被占、只读、杀毒软件锁着）时，
    // 这个 tmp 就留在库目录里没人管——实测 rename 报 EPERM 之后 data.json.tmp 还在。
    // 它比真库还新，谁看到都会以为「写进去了」。失败就把它撤掉。
    try {
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, JSON.stringify(data))
      // 真刷盘：以前这里是个空 try，注释写着"Windows 上由 close 保证落盘"——
      // 那只保证句柄关了，不保证数据离开系统缓存。断电/强杀时 rename 之后
      // 盘上可能是半截 JSON。2026-11-14 实测后补上。
      try { fsyncSync(fd) } catch { /* 少数文件系统不支持，不能因此写不进去 */ }
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, real)
    try {
      const metaPath = join(dir, 'meta.json')
      let meta = {}
      if (existsSync(metaPath)) {
        try { meta = JSON.parse(readFileSync(metaPath, 'utf8').replace(/^\uFEFF/, '')) || {} } catch { meta = {} }
      }
      meta.count = (data.points || []).length
      const d = new Date()
      meta.mtime = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        + ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
    } catch {}
    return { ok: true }
    } catch (e) {
      try { unlinkSync(tmp) } catch {}
      throw e
    }
  } finally {
    unlockSea(lock)
  }
}

export function readSea(sea = 'main') {
  const f = join(seaDir(sea), 'data.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 用一把锁做完一件事：读、改、写。改的时候抛错就不写。 */
export function withSea(sea, fn) {
  const lock = lockSea(sea)
  if (!lock.ok) throw new Error('拿不到写锁：' + (lock.err || ''))
  try {
    const data = readSea(sea) || { version: 1, points: [], edges: [] }
    const next = fn(data)
    if (next === false) { unlockSea(lock); return { ok: false, changed: false } }
    // 2026-11-20：写海的回执原来直接被扔掉——缩水闸拒写也照样回「改了」。
    // 调用方以为写成，其实一个字没动，下次再读还是旧的。把回执传出去。
    const w = writeSea(sea, data, lock)
    if (!w || w.ok === false) {
      return { ok: false, changed: false, err: (w && w.err) || '写盘被拒' }
    }
    return { ok: true, changed: true, data }
  } catch (e) {
    unlockSea(lock)
    throw e
  }
}
