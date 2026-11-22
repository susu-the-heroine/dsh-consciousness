/**
 * 海目录太乱的时候，看看哪些是测试留下的
 * ==================================
 *
 *   node scripts/seas-cleanup.mjs          # 只看，不动
 *   node scripts/seas-cleanup.mjs --apply  # 真删（只删"看着像测试"的，且先备份到回收站目录）
 *
 * 判断"像测试"：名字带 test/lab/empty/real\d/sandbox/验收/演示 之外的自造名不算。
 * 一律不碰 main。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { isMainSea } from './_guard-main.mjs'

import { homedir } from 'node:os'
import { join } from 'node:path'

const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
const TRASH = join(homedir(), '.dsh', 'consciousness-seas-trash')
const apply = process.argv.includes('--apply')

const TESTY = /^(test|_lab|empty|sandbox|real\d+|evolve_lab|mask_lab|supersede_lab|test_cycle|验收|演示|__)/i

if (!existsSync(SEAS)) {
  console.log('还没有海目录：' + SEAS)
  process.exit(0)
}

const rows = []
for (const name of readdirSync(SEAS, { withFileTypes: true })) {
  // 2026-11-21：原来不区分文件还是目录——海目录里放着一个 html（页面就搁在那儿），
  // 也被当成一个「海」列出来，名字要是撞上测试前缀，--apply 就会把它当目录删掉。
  // 实测干跑时列表里就有「意识海_触屏版.html · 0 条」这一行。
  if (!name.isDirectory()) continue
  if (isMainSea(name.name)) continue
  const dir = join(SEAS, name.name)
  let count = 0
  let mtime = 0
  try { mtime = statSync(dir).mtimeMs } catch {}
  try {
    const d = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
    count = Array.isArray(d.points) ? d.points.length : 0
  } catch {}
  rows.push({ name: name.name, count, mtime, testy: TESTY.test(name.name) })
}

rows.sort((a, b) => (a.testy === b.testy ? b.count - a.count : a.testy ? -1 : 1))
for (const r of rows) {
  const when = r.mtime ? new Date(r.mtime).toISOString().slice(0, 16).replace('T', ' ') : '?'
  console.log(`${r.testy ? '[像测试]' : '[留着]  '} ${r.name} · ${r.count} 条 · ${when}`)
}

const junk = rows.filter((r) => r.testy)
console.log('')
console.log(`共 ${rows.length} 个非 main 的海，其中 ${junk.length} 个看着是测试留下的，合计 ${junk.reduce((n, r) => n + r.count, 0)} 条。`)

if (!apply) {
  console.log('只是看看。要真删，加 --apply；删之前会先拷到 ' + TRASH)
  process.exit(0)
}

if (!junk.length) {
  console.log('没有要删的。')
  process.exit(0)
}

mkdirSync(TRASH, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
for (const r of junk) {
  const to = join(TRASH, stamp + '-' + r.name)
  try {
    cpSync(join(SEAS, r.name), to, { recursive: true })
    rmSync(join(SEAS, r.name), { recursive: true, force: true })
    console.log('已挪走：' + r.name)
  } catch (e) {
    console.log('没挪成：' + r.name + ' — ' + String(e && e.message))
  }
}
console.log('挪到：' + TRASH)
