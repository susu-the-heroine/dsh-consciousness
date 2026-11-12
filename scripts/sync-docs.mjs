/**
 * 档案索引：把桌面档案和记忆目录里的 md 全登记一遍。
 *
 * 为什么单独一个文件、不塞进识海：
 *   识海那一百多条是「人和事」，是她的记忆。文档是资料，一股脑塞进去会把球冲乱。
 *   所以单独存一份索引，注入时挑几行给她看——「文档变了，该重看」。
 *
 * 怎么算变没变：内容 sha1。只改时间没改字，不算变。
 *
 * 用法：
 *   node scripts/sync-docs.mjs          扫一遍，写索引
 *   node scripts/sync-docs.mjs --show   扫完打印前十条
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename, relative } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

const HOME = homedir()
const OUT = join(HOME, '.dsh', 'consciousness-docs.json')

const ROOTS = [
  { dir: join(HOME, 'Desktop', '大肥鱼档案'), tag: '档案' },
  { dir: join(HOME, 'Desktop', '识海工厂_2026-11-07'), tag: '工厂' },
  { dir: join(HOME, '.dsh', '记忆'), tag: '记忆库' },
]

const MAX_PER_FILE = 4000 // 只取前 4000 字做摘要，够判断讲什么

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) continue
    if (name.startsWith('_')) continue // _heart_b64.txt 这类是图，不是文档
    if (!/\.(md|txt)$/i.test(name)) continue
    acc.push({ path: p, size: st.size, mtime: st.mtimeMs })
  }
  return acc
}

function firstLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/^[#>\s*-]+/, '').trim()
    if (!s) continue
    if (/^\|/.test(s)) continue
    return s.slice(0, 60)
  }
  return ''
}

const prevFile = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { items: {} }
const prev = prevFile.items || {}
const next = {}
const changed = []

for (const root of ROOTS) {
  for (const f of walk(root.dir)) {
    let text = ''
    try { text = readFileSync(f.path, 'utf8') } catch { continue }
    const head = text.slice(0, MAX_PER_FILE)
    // 算全文，不算前 4000 字——实测在文件末尾加一行，只算前段会漏掉，报 0 变动。
    const hash = createHash('sha1').update(text).digest('hex').slice(0, 12)
    const key = root.tag + '/' + relative(root.dir, f.path).replace(/\\/g, '/')
    const old = prev[key]
    next[key] = {
      tag: root.tag,
      title: firstLine(head) || basename(f.path),
      file: basename(f.path),
      path: f.path,
      chars: text.length,
      mtime: f.mtime,
      hash,
      changedAt: old && old.hash !== hash ? Date.now() : (old ? old.changedAt : Date.now()),
      isNew: !old,
      didChange: !!old && old.hash !== hash,
    }
    if (!old || old.hash !== hash) changed.push(next[key])
  }
}

writeFileSync(OUT, JSON.stringify({ at: Date.now(), count: Object.keys(next).length, items: next }, null, 0), 'utf8')

console.log(`登记 ${Object.keys(next).length} 份，变动 ${changed.length} 份 → ${OUT}`)
if (process.argv.includes('--show')) {
  for (const c of changed.slice(0, 10)) console.log(`  ${c.isNew ? '新' : '改'}｜${c.tag}｜${c.file}｜${c.title}`)
}
