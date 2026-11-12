/**
 * Markdown 反向导入（先干跑）
 * ==========================
 *
 * 规则很简单，就三条：
 *   文件没改 → 跳过
 *   只有文件改了、库里还是导出时那份 → 应用（以文件为准）
 *   文件改了、库里也改了 → 冲突，不覆盖，列出来让人定
 *
 * 为什么这么定：镜像给人手改，但库也在被插件写。两边都动过的，
 * 机器猜哪个对都是赌，赌输就丢记忆。
 *
 * 跑法：node scripts/md-import.mjs [sea] [--apply]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const apply = process.argv.includes('--apply')
// 2026-11-12 决定：镜像只读，反向写回默认停用。真要写才加 --force-write-back
const forceBack = process.argv.includes('--force-write-back')
const mirror = join(homedir(), '.dsh', 'consciousness-mirror', sea)

const S = await import('file:///' + join(HERE, '..', 'lib', 'store-js.js').replace(/\\/g, '/') + '?v=' + Date.now())
const hash = (s) => createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16)

if (!existsSync(mirror)) { console.log('没有镜像目录:', mirror); process.exit(1) }

/** 拆 front-matter 与正文；正文末尾那段「> 别人可能这样问」不算正文 */
function parseMd(body) {
  const m = String(body).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n([\s\S]*)$/)
  if (!m) return null
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) { try { v = JSON.parse(v) } catch {} }
    fm[k] = v
  }
  // 正文：去掉开头那段「> 别人可能这样问」的说明，剩下都是人写的东西
  let text = m[2].replace(/\s+$/, '')
  text = text.replace(/^(?:>\s*别人可能这样问：[^\n]*\n+)+/, '')
  return { fm, text }
}

const lock = S.lockSea(sea)
if (!lock.ok) { console.log('拿不到锁:', lock.err); process.exit(1) }
try {
  const data = S.readSea(sea)
  const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))
  const files = readdirSync(mirror).filter((f) => f.endsWith('.md'))
  const changed = [], conflicts = [], orphans = []
  let same = 0
  for (const f of files) {
    let parsed = null
    try { parsed = parseMd(readFileSync(join(mirror, f), 'utf8')) } catch {}
    if (!parsed || !parsed.fm.id) continue
    const id = Number(parsed.fm.id)
    const p = byId.get(id)
    if (!p) { orphans.push(f); continue }
    const fileH = hash(parsed.text)
    const storedH = String(parsed.fm.text_hash || '')
    const dbH = hash(p.text)
    if (fileH === storedH) { same++; continue }             // 文件没改
    if (dbH === storedH) {                                   // 只有文件改了
      changed.push({ id, file: f, before: p.text, after: parsed.text, alias: parsed.fm.alias })
    } else {
      conflicts.push({ id, file: f, dbH, fileH, storedH })   // 两边都改
    }
  }

  console.log(`镜像 ${files.length} 个 · 没变 ${same} · 只有文件改了 ${changed.length} · 冲突 ${conflicts.length} · 库里没有 ${orphans.length}`)
  for (const c of changed.slice(0, 10)) console.log(`  可应用 #${c.id} ${c.file.slice(0, 34)}`)
  for (const c of conflicts.slice(0, 10)) console.log(`  冲突   #${c.id} ${c.file.slice(0, 34)}（库和文件都改了，不覆盖）`)
  for (const o of orphans.slice(0, 10)) console.log(`  孤儿   ${o}（库里没这个编号，不新建）`)

  if (!apply || !forceBack) {
    S.unlockSea(lock)
    console.log('')
    console.log(forceBack ? '干跑，没写。加 --apply 才真写。' : '镜像只读（默认）。要写回得同时加 --apply --force-write-back。')
  } else {
    let n = 0
    for (const c of changed) {
      const p = byId.get(c.id)
      if (!p) continue
      p.text = c.after
      if (c.alias && String(c.alias).trim()) p.alias = String(c.alias).trim()
      p.editedByHand = Date.now()
      n++
    }
    if (n) {
      try { S.backupSea(sea) } catch (e) { console.log('备份失败:', String(e && e.message)) }
      S.writeSea(sea, data, lock)
    } else {
      S.unlockSea(lock)
    }
    console.log('')
    console.log(`写入 ${n} 条（冲突和孤儿一律没动）`)
  }
} catch (e) {
  try { S.unlockSea(lock) } catch {}
  console.log('出错:', String((e && e.message) || e))
  process.exit(1)
}
