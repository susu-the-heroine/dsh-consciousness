import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 别名候选验收：加上去到底有没有用
 * ================================
 *
 * 做法：拷一份海到临时 HOME，先在「没加别名」时量每个候选问法的排名，
 * 把候选别名加进副本，再在新进程里重量一遍——看排名有没有往前。
 * 不碰他的库、不碰真实日志。
 *
 * 跑法：node scripts/alias-verify.mjs [--sea=main]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv.find((a) => a.startsWith('--sea='))?.slice(6) || 'main'
const phase = process.argv.find((a) => a.startsWith('--phase='))?.slice(8) || ''
const homeArg = process.argv.find((a) => a.startsWith('--home='))?.slice(7)

const realHome = process.env.USERPROFILE || homedir()
const tmpHome = homeArg || join(tmpdir(), 'c2-alias-verify-' + Date.now())

function prep() {
  const d = join(tmpHome, '.dsh', 'consciousness-seas', sea)
  mkdirSync(d, { recursive: true })
  const src = join(realHome, '.dsh', 'consciousness-seas', sea, 'data.json')
  if (!existsSync(join(d, 'data.json'))) copyFileSync(src, join(d, 'data.json'))
}

// ---- 子流程：量排名（在新进程里跑，避开模块缓存） ----
if (phase === 'before' || phase === 'after') {
  process.env.USERPROFILE = tmpHome
  process.env.HOME = tmpHome
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())
  const cands = JSON.parse(readFileSync(join(HERE, 'data', 'alias-candidates-auto.json'), 'utf8')).candidates
  const rows = []
  for (const c of cands) {
    const r = await T.searchTool.execute({ sea, query: c.phrase, review: false })
    const ids = [...String(r.log || '').matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
    const rank = ids.indexOf(c.point) + 1
    rows.push({ phrase: c.phrase, point: c.point, rank: rank || null, top1: ids[0] || null })
  }
  console.log('JSON:' + JSON.stringify(rows))
  process.exit(0)
}

// ---- 父流程 ----
prep()
const run = (p) => {
  const r = spawnSync(_nodeBin, [fileURLToPath(import.meta.url), '--phase=' + p, '--sea=' + sea, '--home=' + tmpHome], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const line = String(r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('JSON:'))
  if (!line) throw new Error('子流程没回数据：' + (r.stderr || '').slice(0, 300))
  return JSON.parse(line.slice(5))
}

const before = run('before')

// 把候选别名写进副本
const f = join(tmpHome, '.dsh', 'consciousness-seas', sea, 'data.json')
const data = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))
let added = 0
for (const c of before) {
  const p = byId.get(Number(c.point))
  if (!p) continue
  // 2026-11-21：这里原来把别名加成数组。可真库里 alias 是字符串，整条链路都用 String(alias)
  // 读它——加成数组，量的是生产里根本不会出现的一种形状，排名往前了也不能说明上真库有用。
  // 改成跟生产一样：用顿号接成一句话。
  const cur = String(p.alias || '').trim()
  if (!cur.includes(c.phrase)) { p.alias = cur ? cur + '、' + c.phrase : c.phrase; added++ }
}
writeFileSync(f, JSON.stringify(data), 'utf8')

const after = run('after')

const afterMap = new Map(after.map((r) => [r.phrase, r]))
let better = 0, same = 0, worse = 0, got1 = 0
console.log(`加了 ${added} 条别名（只写临时副本）`)
console.log('| 问法 | 目标 | 加前排名 | 加后排名 |')
console.log('| --- | --- | --- | --- |')
for (const b of before) {
  const a = afterMap.get(b.phrase) || {}
  const rb = b.rank == null ? '没出现' : b.rank
  const ra = a.rank == null ? '没出现' : a.rank
  if (a.rank === 1) got1++
  if (b.rank == null && a.rank != null) better++
  else if (b.rank != null && a.rank != null && a.rank < b.rank) better++
  else if (b.rank === a.rank) same++
  else worse++
  console.log(`| ${b.phrase} | #${b.point} | ${rb} | ${ra} |`)
}
console.log(`结果：加完头名 ${got1}/${before.length}；往前 ${better}，不变 ${same}，退后 ${worse}`)
