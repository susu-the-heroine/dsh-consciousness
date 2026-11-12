/**
 * 归档
 * ====
 *
 * 判据是「同类里最淡的那批」，不是绝对时间。
 * 为什么：幂律有长尾，S=30 的记忆要三年才掉到 0.18 —— 绝对阈值等于永远不触发。
 *
 * 归档不删，只标。捞得回来。
 */
import { ARCHIVE_DAYS, ARCHIVE_IMP, ARCHIVE_R } from './paths.js'
import { forgettable, isSetting } from './kinds.js'
import { rawDecayOf } from './decay.js'

export function shouldArchive(p, now = Date.now()) {
  if (!p || p.dead || p.archived) return false
  if (!forgettable(p)) return false          // 禁区/承诺/画像永不归档
  if (p.validUntil) return false             // 失效事实单独处理
  if (isSetting(p)) return false             // 设定不收（不只是 core 层）
  if (p.gold) return false
  const t0 = Math.max(Number(p.born) || 0, Number(p.lastSeen) || 0)
  if (!t0) return false
  const days = (now - t0) / 86400000
  if (days < ARCHIVE_DAYS) return false
  if ((Number(p.imp) || 0.5) >= ARCHIVE_IMP) return false
  // 用基础衰减判，不用显示亮度
  return rawDecayOf(p, now) < ARCHIVE_R
}

/**
 * 扫一遍，把该归档的标上。只标不删。
 *
 * 判据是「同类里最淡的那批」，不是绝对时间。
 * 为什么改：幂律有长尾，S=30 的记忆要三年才掉到 0.18 —— 绝对阈值等于永远不触发。
 * 人的脑子不是「三年后统一清理」，是「一直最想不起来的那些，慢慢就找不着了」。
 *
 * 两条腿走路：
 *   ① 相对：池子里最淡的 5%（池子至少 50 条）
 *   ② 绝对：裸衰减 < 0.18（兜底，真烂透了就收）
 */
export function sweepArchive(data, dry = false) {
  const now = Date.now()
  const out = []

  const pool = (data.points || []).filter(
    (p) => !p.dead && !p.archived && forgettable(p) && p.layer !== 'core' && !p.gold && !p.validUntil,
  )

  const picked = new Set()

  // ① 相对：最淡的 5%
  if (pool.length >= 50) {
    const sorted = pool.slice().sort((a, b) => rawDecayOf(a, now) - rawDecayOf(b, now))
    const cut = Math.max(1, Math.floor(sorted.length * 0.05))
    for (const p of sorted.slice(0, cut)) {
      // 0.9 是个保守门槛：刚写几天的记忆再「相对最淡」也不动它。
      // 三个月后裸衰减自然掉到 0.7 上下，那时候才开始收。
      if (rawDecayOf(p, now) < 0.9) picked.add(p)
    }
  }

  // ② 绝对：真烂透了
  for (const p of pool) {
    if (shouldArchive(p, now)) picked.add(p)
  }

  // 加两道闸：一次最多收 1 条，一天最多 1 条。
  // 为什么：扫描是挂在「写记忆 / 开页面 / 检索」上的，一天能跑几十次；
  // 实测（仿真）：一天 5 条，三十天能吃掉一半库。库不是靠一次清扫维持的。
  // 遗忘该像慢慢褪色，不该像跳闸。2026-11-11 深夜。
  const PER_RUN = 1
  const PER_DAY = 1
  const today = new Date(now).toISOString().slice(0, 10)
  if (!data.archiveDaily || data.archiveDaily.day !== today) {
    data.archiveDaily = { day: today, n: 0 }
  }
  const roomToday = Math.max(0, PER_DAY - (Number(data.archiveDaily.n) || 0))
  const allow = Math.min(PER_RUN, roomToday, picked.size)
  if (!allow) return []

  // 按裸衰减从低到高取，先收最想不起来的
  const ordered = [...picked].sort((a, b) => rawDecayOf(a, now) - rawDecayOf(b, now)).slice(0, allow)
  const pickedList = ordered

  for (const p of pickedList) {
    const r = rawDecayOf(p, now)
    out.push({ id: p.id, title: String(p.title || '').slice(0, 30), r: Number(r.toFixed(3)) })
    if (!dry) {
      p.archived = true
      p.archivedAt = now
      p.archiveReason = r < 0.18
        ? ('烂透了 · 基础衰减 ' + r.toFixed(2))
        : ('同类最淡的 5% · 基础衰减 ' + r.toFixed(2))
    }
  }
  data.archiveDaily.n = (Number(data.archiveDaily.n) || 0) + pickedList.length
  return out
}

/** 捞回来 */
export function unarchive(data, id) {
  const p = (data.points || []).find((x) => Number(x.id) === Number(id))
  if (!p) return null
  p.archived = false
  delete p.archivedAt
  delete p.archiveReason
  p.lastSeen = Date.now()
  return p
}
