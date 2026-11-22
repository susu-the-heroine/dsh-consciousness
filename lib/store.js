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
  linkSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
  fsyncSync,
} from 'node:fs'
import { replaceAll as mirrorReplaceAll } from './sqlite-mirror.js'
import { join, dirname } from 'node:path'
import { flagDuplicates } from './dup.js'
import { audit } from './log.js'
import { BACKUP_DIR, SEAS_DIR } from './paths.js'
import { CURRENT_SCHEMA, detectVersion, stampVersion } from './versioning.js'

/**
 * 库名合法吗。2026-11-19：以前这里零校验，库名带 ../ 就能把读写支到数据目录外面去。
 * 规则很窄——只挡真正的路径穿越，中文名、空格、点结尾这些照旧放行。
 */
export function isSeaName(sea) {
  const s = String(sea == null ? '' : sea)
  if (!s || s.length > 64) return false
  if (/[\\/:*?"<>|\x00-\x1f]/.test(s)) return false
  if (s === '.' || s === '..') return false
  // 2026-11-20（Windows 专属）：名字末尾是点或空格时，系统会把它悄悄当成没有——
  // 「main.」和「main」落到同一个目录。允许它就等于允许两个名字写一个库。
  if (s.endsWith('.') || s.endsWith(' ')) return false
  return true
}

/** 一个识海的 data.json 路径。库名不合法直接抛，别把路径拼到别处去 */
export const seaPath = (sea) => {
  if (!isSeaName(sea)) {
    const e = new Error('bad sea name: ' + String(sea).slice(0, 40))
    e.code = 'EBADSEA'
    throw e
  }
  return join(SEAS_DIR, sea, 'data.json')
}

/** 给路由用：库名不合法就返回空串，调用方当「没有这个海」处理 */
export function seaDataPath(sea) {
  try { return seaPath(sea) } catch { return '' }
}

/** 读一个识海。读不到返回 null，不抛 */
export function readSea(sea) {
  let p = ''
  try { p = seaPath(sea) } catch {
    try { audit('read-sea-badname', { sea: String(sea).slice(0, 40) }) } catch {}
    return null
  }
  if (!existsSync(p)) return null
  try {
    const data = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
    // 号太新拒读：这是将来版本写的数据，老代码拿它去改只会改坏。2026-11-15 收口版本号时加。
    // 2026-11-20：老版本的拼音缓存（_py）被写进过库文件——它是坏缓存（对子集合存成了空对象），
    // 读进来一用就抛。读的时候统一剔掉，下次写盘自然就干净了。
    try {
      if (data && Array.isArray(data.points)) for (const _p of data.points) if (_p && '_py' in _p) delete _p._py
    } catch {}
    // 2026-11-22：风格/自我不是普通记忆，读的时候就剔掉，别让页面和注入看见。
    // 早先 134 条 style 是死数据（存错地方的历史包袱），下次写盘自然就清干净了。
    try {
      if (data && Array.isArray(data.points)) data.points = data.points.filter((x) => x && x.kind !== 'style' && x.kind !== 'self')
    } catch {}
    const v = detectVersion(data)
    if (v > CURRENT_SCHEMA) {
      try { audit('read-sea-version-too-new', { sea, v, current: CURRENT_SCHEMA }) } catch {}
      return null
    }
    return data
  } catch {
    return null
  }
}


// 镜像（防抖）：写库很频繁（每次被想起都可能改强度），两秒内的多次写合成一次全量镜像。
// 失败只吞掉——JSON 才是权威，绝不因为镜像拖垮写入。
const _mirrorTimers = new Map()

// 2026-11-19（清单 P25/P33 的伴生问题）：抢锁失败时原来是"空转等"——CPU 满转还抢不到别的活。
// 锁必须是同步的（调用点全是同步函数），所以用 Atomics.wait 真睡，既不烧 CPU，
// 语义也没变：到点就返回，超时照样报错。不支持时退回空转。
const _sleepBuf = new Int32Array(new SharedArrayBuffer(4))
function blockSleep(ms) {
  const t = Math.max(0, Math.floor(ms))
  if (!t) return
  try {
    Atomics.wait(_sleepBuf, 0, 0, t)
  } catch {
    const end = Date.now() + t
    while (Date.now() < end) { /* 极老运行时才走这里 */ }
  }
}
// 2026-11-21：镜像的去抖定时器带 unref，进程一退它就没了——JSON 写成了、镜像没跟上，
// 沙箱那行漂移就是这么来的（两边的探针文本不一样）。加一个退出前冲洗。
const _pendingMirror = new Map()
let _flushHooked = false
function _flushMirrors() {
  for (const [sea, v] of _pendingMirror) {
    try {
      const _m = mirrorReplaceAll(sea, v.points, v.edges)
      if (_m && _m.ok === false) {
        try { audit('mirror-sync-failed', { sea, err: String(_m.err || '没写进去').slice(0, 120) }) } catch {}
      }
    } catch (e) {
      try { audit('mirror-sync-failed', { sea, err: String((e && e.message) || e).slice(0, 120) }) } catch {}
    }
  }
  _pendingMirror.clear()
}
// 2026-11-21：兜底——不管哪条路忘了放锁，只要这把锁是自己的、又超过三秒没在写，就当残留清掉。
// 为什么不再靠「逐条改放锁」：同一件事散在两层六个文件里，改了三轮还有第四个没走到。
// 这个看守不改变任何写逻辑，只在「没人正在写」的时候收拾自己的残锁；别人的锁一律不碰。
let _writing = 0
const _heldLocks = new Set()
let _janitorOn = false
function _lockJanitor() {
  if (_writing > 0) return
  try {
    let seas = []
    try { seas = readdirSync(SEAS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { seas = [] }
    for (const sea of seas) {
      const lp = join(SEAS_DIR, sea, 'data.json.lock')
      if (!existsSync(lp)) continue
      let age = 0
      try { age = Date.now() - statSync(lp).mtimeMs } catch { continue }
      if (age < 3000) continue
      if (_heldLocks.has(lp)) continue // 正在被攥着（比如整段改写的中间），别收
      // 读不出内容就当不是自己的：宁可多等六十秒，也不替别人拆锁。
      let pid = -1
      try { pid = Number(JSON.parse(readFileSync(lp, 'utf8').replace(/^\uFEFF/, '')).pid) || 0 } catch { pid = -1 }
      if (pid !== process.pid) continue
      try {
        unlinkSync(lp)
        try { audit('write-lock-janitor', { sea, ageMs: Math.round(age), pid }) } catch {}
      } catch {}
    }
  } catch {}
}
function _startJanitor() {
  if (_janitorOn) return
  _janitorOn = true
  try {
    const t = setInterval(_lockJanitor, 15000)
    if (t && typeof t.unref === 'function') t.unref()
  } catch {}
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
    const points = (data && data.points) || []
    _hookFlush()
    _pendingMirror.set(sea, { points, edges: (data && data.edges) || [] })
    const t = setTimeout(() => {
      _mirrorTimers.delete(sea)
      _pendingMirror.delete(sea)
      if (points.length > 5000) return
      // 2026-11-21：镜像写失败原来一声不响。沙箱那次真漂过一行，全靠尺子逮住。
  // 现在把失败记下来——store-js 那边早就会记，旧存储层这边不能漏。
  try {
    const _m = mirrorReplaceAll(sea, points, (data && data.edges) || [])
    if (_m && _m.ok === false) {
      try { audit('mirror-sync-failed', { sea, err: String(_m.err || '没写进去').slice(0, 120) }) } catch {}
    }
  } catch (e) {
    try { audit('mirror-sync-failed', { sea, err: String((e && e.message) || e).slice(0, 120) }) } catch {}
  }
    }, 2000)
    if (t && typeof t.unref === 'function') t.unref()
    _mirrorTimers.set(sea, t)
  } catch {}
}

/** 写一个识海。原子写：tmp + rename */
/** 放锁：多试两下，失败要出声。
 *  2026-11-21：审计里一百八十条「自己的锁过期」、十四条等锁超时、十四条被拒，
 *  可一次「写失败」都没有——说明写是成的，锁却没删掉。删锁原来是一声不吭的 catch。
 */
function _releaseWriteLock(lockPath, sea) {
  try { _heldLocks.delete(lockPath) } catch {}
  // 2026-11-21：三次二十毫秒在 Windows 上不够——杀毒/索引器会短暂占住文件。
  // 改成十次、间隔 20→200 毫秒（合计约一秒），跟 store-js 那边一个规格。
  for (let k = 0; k < 10; k++) {
    try {
      if (!existsSync(lockPath)) return true
      unlinkSync(lockPath)
      globalThis.__C2_WRITING__ = Math.max(0, Number(globalThis.__C2_WRITING__ || 0) - 1)
      // 2026-11-21：诊断用——每次放锁成功也记一行，跟「锁过期」对齐就能看出是谁留的。
      try { audit('write-lock-released', { sea }) } catch {}
      return true
    } catch (e) {
      if (k === 9) {
        try { audit('write-lock-release-failed', { sea, err: String((e && e.code) || e) }) } catch {}
        return false
      }
      blockSleep(20 + k * 20)
    }
  }
  return true
}

export function writeSea(sea, data, opt = {}) {
  // 2026-11-20：Windows 里 Main 和 main 是同一个目录，写进去会互相覆盖。
  // 同级目录里只要有只差大小写的名字，就不许写——宁可报错，也别悄悄并库。
  try {
    const _sid = String(sea || '').trim()
    const _clash = readdirSync(SEAS_DIR).find((n) => n.toLowerCase() === _sid.toLowerCase())
    if (_clash && _clash !== _sid) throw new Error('海名跟已有的只差大小写：' + _clash)
  } catch (e) {
    if (String((e && e.message) || '').indexOf('只差大小写') >= 0) throw e
  }
  stampVersion(data)
  // 写入查重：只查还没查过的点，挂标记不删不合并（2026-11-18 夜）
  try {
    if (!opt.noDup && data && Array.isArray(data.points)) flagDuplicates(data.points, 0.8, { max: 300 })
  } catch {}
  let p = ''
  try { p = seaPath(sea) } catch {
    try { audit('write-sea-badname', { sea: String(sea).slice(0, 40) }) } catch {}
    return false
  }
  // 2026-11-20：镜像原来排在抢锁和缩水闸之前——写被拒了，镜像照样按这份没落盘的数据重排，
  // 两份就不一样了。挪到 rename 成功之后（跟 store-js 那边对齐）。
  const tmp = p + '.tmp'
  // 尽力而为的写锁：不阻塞、不死等。拿到就独写；拿不到最多等 3 秒
  // （一次写入＝备份＋临时文件＋fsync＋rename，实测十几毫秒，3 秒是两个数量级余量），
  // 还是拿不到就照写并记一笔审计——宁可留痕，也不能让用户等着。2026-11-15 从 0.8 秒调到 3 秒。
  // 2026-11-14 夜审计说"这份 writeSea 没有锁"，这是最小代价的补法：
  // 真正串行化需要把两条写库实现合并，那件事留白天做。
  const lockPath = join(dirname(p), 'data.json.lock')
  let held = false
  _startJanitor()
  _writing++
  // 调用方已经持锁（mutateSea）就别再抢一次：同一把锁重入必然等到超时，
  // 然后「照写」把别人的写吞掉——2026-11-18 压测从两百掉到一百八十四就是这么来的。
  try {
    if (opt.noLock) throw { code: 'SKIP_LOCK' }
    mkdirSync(dirname(p), { recursive: true })
    // 2026-11-21 二十点一刻：本进程已用另一套锁（lock.js）拿着这一把，就当已持有。
    if (globalThis.__C2_LOCKED__ && globalThis.__C2_LOCKED__.has(lockPath)) { held = true; _heldLocks.add(lockPath) }
    // 2026-11-21 十九点五八：等多久是产品决定——网页那条路「三秒就回话」是写进自检的承诺。
        // 所以别把预算写死：默认仍是 3 秒（60 × 50ms），批量/备份那种自己把 C2_LOCK_WAIT_MS 调大。
        const _waitIters = Math.max(60, Math.round(Number(process.env.C2_LOCK_WAIT_MS || 3000) / 50))
        for (let i = 0; i < _waitIters && !held; i++) {
      try {
        // 跟 store-js.js 用同一套手法：先写唯一临时文件，再硬链接到锁名。
        // 直接用 'wx' 写内容有一个瞬间文件是空的，另一条路的过期判定会把空文件当"过期锁"删掉，
        // 于是两个进程同时持锁——2026-11-12 那边压测就栽在这。今晚把这条也对齐。
        const lk = join(dirname(p), `.lock-${process.pid}-${Date.now()}-${i}`)
        writeFileSync(lk, JSON.stringify({ at: Date.now(), pid: process.pid }), 'utf8')
        try { linkSync(lk, lockPath); globalThis.__C2_WRITING__ = Number(globalThis.__C2_WRITING__ || 0) + 1 } finally { try { unlinkSync(lk) } catch {} }
        held = true
        _heldLocks.add(lockPath)
      } catch (e) {
        // 锁太老（>60 秒）就当是上次进程崩了留下的，清掉重试一次
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > 60000) {
            unlinkSync(lockPath)
            continue
          }
        } catch {}
        // 锁的主人已经不在（进程崩了）：立刻清掉重试，别让每一次写入都白等 3 秒。
        // 判据是锁文件里的 pid 还活着没有；读到坏内容就当它在，别乱动。
        try {
          const _h = JSON.parse(readFileSync(lockPath, 'utf8').replace(/^\uFEFF/, ''))
          const _pid = Number(_h && _h.pid) || 0
          let _alive = true
          if (_pid > 0) {
            try { process.kill(_pid, 0) } catch (e2) { if (e2 && e2.code === 'ESRCH') _alive = false }
          }
          if (_pid > 0 && !_alive) {
            try { audit('write-lock-holder-dead', { sea, pid: _pid }) } catch {}
            unlinkSync(lockPath)
            continue
          }
          // 2026-11-19：锁是自己上次留下的（同 pid），当残留清掉。
          // 以前这里"照写"把这条遮住了；现在没锁就不写，所以得先把自锁收干净，
          // 否则一次中途失败会让这个进程后面所有的写都写不进去。
          if (_pid === process.pid) {
            // 2026-11-21：只记 sea 分不清「刚写的没放」和「上次崩留下的陈锁」。
            // 补上锁里的 pid 和这把锁放了多久：年龄大于几秒就是陈锁，几十毫秒就是当场没放。
            let _age = -1
            try { _age = Date.now() - statSync(lockPath).mtimeMs } catch {}
            // 2026-11-21 十五点五十六：重启后第一条锁过期，锁龄只有 13 毫秒、pid 就是自己。
            // 不是崩留下的——是同一进程里一层写还没撒手、另一层又来抢，把自己的锁当成了残锁。
            // 手里还攥着就绝不拆：让它排队，等不到就认输，不插队。
            // 2026-11-21 十六点十：只看登记表不够——另一层（store-js）抢锁时不往这张表里登记，
            // 于是同一秒里它立的锁，这边照样当残锁拆。改成看锁龄：两秒以内一律当「有人正在写」，
            // 排队等；两秒以上才当陈锁清掉（崩掉的锁不会只放十几毫秒）。
            // 2026-11-21 十八点五五：十八点十七分那两次过期，age 分别是 2008 和 2029 毫秒——
            // 刚好被我那条「两秒」卡在门外。那不是残锁，是另一个进程正在慢写（备份/大批量）。
            // 改成：锁里那个进程还活着、且没超过 TTL（60 秒），就一直排队等；只有死了或超 TTL 才算残锁。
            let _alive = false
            try { if (_pid) { process.kill(_pid, 0); _alive = true } } catch (e) { _alive = !(e && e.code === 'ESRCH') }
            // 自己名下、又没登记在案：多半是这台进程里上一次写没收尾的残锁，两秒后照旧收。
            // 别的进程还活着：等到 TTL（60 秒）之前都不抢，哪怕它写得慢（备份那类能写好几秒）。
            const _own = _pid && _pid === process.pid
            // 2026-11-21 十九点五二：重启后 22 秒又漏一次，age=2010ms、pid 是咱自己、还活着。
            // 说明「自己名下、没登记」这条分支还是会拆自己——因为同进程里另一层正拿着锁。
            // 补一条：只要本进程里有任何一层在写（__C2_WRITING__ > 0），就不许按年龄拆，等 TTL。
            const _sibling = Number(globalThis.__C2_WRITING__ || 0) > 0
            // 2026-11-21 二十点整：两次重启都在二十秒内又拆一次自己——查到最后是 lib/lock.js 那条路也在拿同一把锁，
            // 可它不认这边的标记。别再猜「自己名下就能收」了：只要锁里那个进程还活着、且没超 TTL，就一律排队等。
            // 真残锁（进程死了）照旧清。等待预算默认三秒，等不到就老实报忙。
            if (_heldLocks.has(lockPath) || _age < 2000 || (_sibling && _age < 60000) || (!_own && _alive && _age < 60000)) {
              try { audit('write-lock-reentrant-wait', { sea, ageMs: Math.round(_age) }) } catch {}
              blockSleep(50)
              continue
            }
            try { audit('write-lock-self-stale', { sea, pid: _pid, ageMs: Math.round(_age), holderAlive: !!_alive }) } catch {}
            _releaseWriteLock(lockPath, sea)
            continue
          }
        } catch {}
        // 2026-11-21 十九点五五：最多只等三秒（60×50ms）不够——慢写三秒的实测里
        // 这一笔等到了 3083 毫秒，刚好撞在收尾上，直接认输没写进去。
        // 改成等满一个 TTL（60 秒）：60×50 不够就 1200 次，撞上就记超时。
        if (i === _waitIters - 1) { try { audit('write-lock-timeout', { sea }) } catch {} }
        if (i < _waitIters - 1) {
          blockSleep(50)
        }
      }
    }
  } catch (e0) { if (!e0 || e0.code !== 'SKIP_LOCK') { try { audit('write-lock-err', { sea }) } catch {} } }

  // 2026-11-19：拿不到锁就不许写。原来这里写着"照写并记一笔审计"——
  // 故障注入一验：锁被别人攥着，它照样把库写了，条数多一条。
  // 并发丢条就是从这儿来的。现在没锁直接认输，交调用方处理。
  if (!held && !opt.noLock) {
    try { audit('write-sea-lock-refused', { sea }) } catch {}
    _writing--
    return false
  }

  // 2026-11-20：缩水拦截原来在抢锁之前读旧库，读与写之间有缝，两路同时写时会算错。
  // 锁已经攥在手里，这里用锁内的新鲜读数再判一次。
  try {
    const _nowN2 = Array.isArray(data && data.points) ? data.points.length : 0
    if (existsSync(p)) {
      const _prev2 = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
      const _prevN2 = Array.isArray(_prev2 && _prev2.points) ? _prev2.points.length : 0
      if (_prevN2 >= 20 && _nowN2 * 2 < _prevN2) {
        try { audit('write-sea-shrink-blocked-locked', { sea, prevN: _prevN2, nowN: _nowN2 }) } catch {}
        if (held) _releaseWriteLock(lockPath, sea)
        return false
      }
    }
  } catch {}

  // 写之前先留一份：这份 writeSea 没有锁，调用方也不一定记得备份。
  // 有了这一手，最坏情况也只是丢最后几分钟，不是丢整个库。（2026-11-14 审计后补）
  // 2026-11-21：备份失败原来一声不响，接着照写——「写前先留一份」这句保证
  // 就等于没有。实测把备份目录的位置占成一个文件，备份没成、旧的照样被盖掉、审计零条。
  // 这里只留一条审计，不拦写：这台机器上备份目录坏掉时，拦下来等于连新记忆都存不进去。
  let _bk = null
  try { _bk = backupSea(sea) } catch (e) { _bk = { ok: false, err: String((e && e.message) || e) } }
  if (_bk && _bk.ok === false) {
    try { audit('backup-before-write-failed', { sea, err: String(_bk.err || '没备成').slice(0, 120) }) } catch {}
  }
  try {
    // 目录不存在就自己建。之前不建，写失败还静默返回 false——
    // 五套新识海第一次全挂在这，查了半天。
    mkdirSync(dirname(p), { recursive: true })
    // 真刷盘：writeFileSync 只保证数据进了系统缓存，断电/强杀时 rename 之后
    // 盘上可能是半截 JSON。这条主路之前没有 fsync（另一份实现才有）。（2026-11-14）
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, JSON.stringify(data))
      try { fsyncSync(fd) } catch { /* 少数文件系统不支持，不能因此写不进去 */ }
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, p)
    if (held) _releaseWriteLock(lockPath, sea)
    mirrorSoon(sea, data)
    return true
  } catch (e) {
    try { audit('write-sea-fail', { sea, err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    // 2026-11-21 下午：写失败这条路原来不走放锁——锁留在盘上，TTL 六十秒，
    // 接着每一次写都得等到过期、或者干脆被拒（write-sea-lock-refused），
    // 表现就是「插件像死了，重启一下又好了」。审计里那一串 write-lock-self-stale
    // 每四分钟一条，就是这笔账。失败也必须放锁。
    if (held) _releaseWriteLock(lockPath, sea)
  } finally { _writing-- }
}

/** 备份一份。保留 14 天，超期的自动删 */
/**
 * 事务式改写：锁住 → 读最新 → 改 → 写 → 解锁。
 *
 * 为什么要有：writeSea 只锁「写」那一下，两个进程各自 readSea 再 writeSea，
 * 中间读到的都是旧快照，后写的会把先写的吞掉（2026-11-18 四进程压测实测丢 3/4）。
 * 要做跨进程安全，必须把「读—改—写」整段放进同一把锁。
 * fn 收到当前数据，返回新数据；返回 null 表示不改。
 */
export function mutateSea(sea, fn) {
  let p = ''
  try { p = seaPath(sea) } catch {
    try { audit('mutate-sea-badname', { sea: String(sea).slice(0, 40) }) } catch {}
    return null
  }
  const dir = dirname(p)
  const lp = join(dir, 'data.json.lock')
  mkdirSync(dir, { recursive: true })
  let held = false
  for (let i = 0; i < 600 && !held; i++) {
    try {
      const lk = join(dir, `.lock-${process.pid}-${Date.now()}-${i}`)
      writeFileSync(lk, JSON.stringify({ at: Date.now(), pid: process.pid }), 'utf8')
      try { linkSync(lk, lp) } finally { try { unlinkSync(lk) } catch {} }
      held = true
      _heldLocks.add(lp)
    } catch {
      try {
        if (Date.now() - statSync(lp).mtimeMs > 60000) { unlinkSync(lp); continue }
      } catch {}
      blockSleep(20)
    }
  }
  if (!held) {
    try { audit('mutate-lock-timeout', { sea }) } catch {}
    return false
  }
  try {
    // 2026-11-20：readSea 读不动的（版本比本进程新、JSON 坏了）不能当「空库」——
    // 当空库再写回去，等于把人家整个库抹了。文件在、读不出来，就认输。
    const _exists = existsSync(p)
    const _cur = readSea(sea)
    if (!_cur && _exists) {
      try { audit('mutate-sea-unreadable-refused', { sea }) } catch {}
      return false
    }
    const cur = _cur || { version: 3, points: [], edges: [] }
    const next = fn(cur)
    if (!next) return false
    return writeSea(sea, next, { noLock: true })
  } finally {
    // 2026-11-21：mutateSea 原来放锁也是一声不吭、还不重试——同 writeSea 那个坑。
    if (held) _releaseWriteLock(lp, sea)
  }
}
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
    // 2026-11-20：跟另一份实现同一个坑——文件名精确到秒，同一秒里备两次，后一份盖前一份。
    // 连着改两下，要回滚的那一步正好没了。撞名就加序号。
    let dst = join(dir, name)
    for (let i = 2; existsSync(dst) && i < 100; i++) {
      dst = join(dir, name.replace(/\.json$/, '-' + i + '.json'))
    }
    copyFileSync(src, dst)
    // 向量与账本一起备：回滚时光还原记忆本体，向量对不上还得重建一遍（2026-11-18 夜）
    try {
      const base = name.replace(/\.json$/, '')
      const seaDir = join(SEAS_DIR, sea)
      for (const [suffix, tag] of [['vectors.json', '.vectors.json'], ['vectors.bin', '.vectors.bin'], ['vectors.idx.json', '.vectors.idx.json']]) {
        const p = join(seaDir, suffix)
        if (!existsSync(p)) continue
        // 2026-11-21：向量复制失败原来一声不响——备份里只有记忆没有向量，
        // 回滚时光把记忆放回去、向量对不上还得重建。失败要说。
        try { copyFileSync(p, join(dir, base + tag)) } catch (e) {
          try { audit('backup-vectors-copy-failed', { sea, file: suffix, err: String((e && e.code) || e).slice(0, 60) }) } catch {}
        }
      }
    } catch {}
    // 备份收口（2026-11-15）：三种都留——最新一份、每天的头一份（14 天内）、其余最多二十份。
    // 其余（同一分钟挤进来的、超出额度的）删掉。总量封顶 100，14 天外全清。
    try {
      const csv = (f) => /^\d{8}-\d{6}\.json$/.test(f)
      const all = readdirSync(dir).filter(csv).sort()   // 名字带时间，排序即时间序
      if (!all.length) return
      const keep = new Set()
      keep.add(all[all.length - 1]) // 最新一份必留
      const byDay = new Map()
      for (const f of all) {
        const day = f.slice(0, 8)
        if (!byDay.has(day)) byDay.set(day, f)
      }
      const _cut = new Date(Date.now() - 14 * 86400000)
      const _pd = (n) => String(n).padStart(2, '0')
      const cutoffDay = String(_cut.getFullYear()) + _pd(_cut.getMonth() + 1) + _pd(_cut.getDate())
      for (const [day, f] of byDay) if (day >= cutoffDay) keep.add(f)
      for (const f of all.slice(-20)) keep.add(f)
      for (const f of all) {
        if (keep.has(f)) continue
        try { unlinkSync(join(dir, f)) } catch {}
      }
      // 向量/账本副档跟着主备份同生共死，别让它们无限堆
      const keepBase = new Set([...keep].map((f) => f.replace(/\.json$/, '')))
      for (const f of readdirSync(dir)) {
        const m = f.match(/^(\d{8}-\d{6})\.(vectors\.json|vectors\.bin|vectors\.idx\.json)$/)
        if (!m) continue
        if (keepBase.has(m[1])) continue
        try { unlinkSync(join(dir, f)) } catch {}
      }
    } catch {}
    const cutoff = Date.now() - 14 * 86400000
    for (const f of readdirSync(dir)) {
      const fp = join(dir, f)
      try {
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp)
      } catch {
        /* 忽略 */
      }
    }
  } catch (e) {
    // 2026-11-21：备份失败原来只写一句注释就吞掉，调用方根本不知道
    // 「写前先留一份」这条保证已经失效。改成把失败交回去，让人能看见。
    return { ok: false, err: String((e && e.message) || e).slice(0, 120) }
  }
  return { ok: true }
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
  // 2026-11-20：这条口原来不验名字——传个带 ../ 的进来，目录就建到数据目录外面去了。
  // 别处都有这道闸，就这儿漏了。名字不合法就明说没建，别硬拼路径。
  if (!isSeaName(sid) || typeof sid !== 'string') {
    try { audit('ensure-sea-badname', { id: String(id).slice(0, 40) }) } catch {}
    return false
  }
  const dir = join(SEAS_DIR, sid)
  const file = join(dir, 'data.json')
  if (existsSync(file)) return false
  // 2026-11-20：Windows 上 Main 和 main 是同一个目录——建海前先看有没有只差大小写的同名海，
  // 有就直接报错，别悄悄并进别人的库。
  try {
    const _sibs = readdirSync(SEAS_DIR)
    const _clash = _sibs.find((n) => n.toLowerCase() === sid.toLowerCase())
    if (_clash && _clash !== sid) throw new Error('海名跟已有的只差大小写：' + _clash)
  } catch (e) {
    if (String(e && e.message || '').indexOf('只差大小写') >= 0) throw e
  }
  mkdirSync(dir, { recursive: true })
  const empty = {
    version: 1,
    points: [],
    edges: [],
    stats: { points: 0, edges: 0, kinds: { fact: 0, taboo: 0, feeling: 0 } },
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }
  writeFileSync(file, JSON.stringify(empty), 'utf8')
  // 2026-11-21：新建海之后写「海名」失败原来一声不响——面板上那个海只剩编号，
  // 人以为名字没生效。注意 writeMeta 自己不抛，失败是「返回 false」。
  try {
    if (writeMeta(sid, { name: String(name || sid), createdAt: Date.now() }) !== true) {
      try { audit('sea-meta-write-failed', { sea: sid, why: 'writeMeta 返回 false' }) } catch {}
    }
  } catch (e) {
    try { audit('sea-meta-write-failed', { sea: sid, err: String((e && e.code) || e).slice(0, 60) }) } catch {}
  }
  return true
}
