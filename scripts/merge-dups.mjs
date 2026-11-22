/**
 * 合并重复记忆
 * ============
 *
 * 只处理明确认定的对子（评测里认出来的），不做自动查重。
 * 原则：不删。保留信息更全的那条，把另一条里独有的句子并进来，
 * 再把多余那条标 dead + mergedInto，原文留在库里可查。
 *
 * 跑法：node scripts/merge-dups.mjs [sea] [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const apply = process.argv.includes('--apply')

// 认出来的对子（谁和谁是同一件事）
const PAIRS = [[73, 15], [49, 68], [54, 65], [33, 56], [35, 95]]

const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const lock = S.lockSea(sea)
if (!lock.ok) { console.log('拿不到锁:', lock.err); process.exit(1) }

try {
  const data = S.readSea(sea)
  // 2026-11-21：海不存在时 readSea 返回 null，下一行就崩成一句 TypeError。
  // 实测跑一个不存在的海名就是这样——看不出是「名字打错」还是「库坏了」。
  if (!data) {
    try { S.unlockSea(lock) } catch {}
    console.log('没有这个海：' + sea)
    process.exit(2)
  }
  const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))
  const report = []

  for (const [x, y] of PAIRS) {
    const a = byId.get(x), b = byId.get(y)
    if (!a || !b) { report.push(`#${x}/#${y} 缺一条，跳过`); continue }
    if (a.dead || b.dead) { report.push(`#${x}/#${y} 已经死了一条，跳过`); continue }
    // 保留字数多的那条
    const keep = String(a.text || '').length >= String(b.text || '').length ? a : b
    const drop = keep === a ? b : a
    // 把另一条里独有的句子并进来
    const sentences = String(drop.text || '').split(/[。！？\n]/).map((s) => s.trim()).filter((s) => s.length >= 8)
    const have = String(keep.text || '')
    const add = sentences.filter((s) => !have.includes(s.slice(0, 8)))
    const merged = add.length ? (String(keep.text || '').trim() + ' ' + add.join('。') + '。') : String(keep.text || '')
    report.push(`#${keep.id} 留下（并进 ${add.length} 句）← #${drop.id} 标死`)
    if (!apply) continue
    keep.text = merged
    if (!keep.alias && drop.alias) keep.alias = drop.alias
    keep.mergedFrom = [...(Array.isArray(keep.mergedFrom) ? keep.mergedFrom : []), drop.id]
    drop.dead = true
    drop.mergedInto = keep.id
    drop.deadAt = Date.now()
  }

  if (apply) {
    // 2026-11-21：备份失败原来只打一行就照样写。实测把备份目录弄坏再跑，它照写不误，
    // 末尾还报「已合并并备份」——这是要标死条目的操作，没有回滚点就不该动。
    let bak = null
    try { bak = S.backupSea(sea) } catch (e) {
      console.log('备份失败:', String(e && e.message))
    }
    if (!bak) {
      try { S.unlockSea(lock) } catch {}
      console.log('没有备份成功，这次一条都不改。先把备份目录修好再来。')
      process.exit(2)
    }
    S.writeSea(sea, data, lock)
  } else {
    S.unlockSea(lock)
  }
  for (const r of report) console.log(' ', r)
  console.log('')
  console.log(apply ? '已合并并备份' : '干跑，没写（加 --apply 才真写）')
} catch (e) {
  try { S.unlockSea(lock) } catch {}
  console.log('出错:', String((e && e.message) || e))
  process.exit(1)
}
