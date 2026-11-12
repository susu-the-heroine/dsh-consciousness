/**
 * 自己数一遍。
 *
 * 为什么要有：2026-11-08 这一晚，我把工具数报了三个版本（13 / 15 / 18），
 * 前两个都是凭印象。人记不住自己的规模，得让机器数。
 *
 * 用法：node scripts/count.mjs [--json]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (['node_modules', '.git', 'backups', 'test', 'scripts', 'assets'].includes(name)) continue
      walk(p, acc)
    } else if (name.endsWith('.js')) acc.push(p)
  }
  return acc
}

let toolNames = new Set()
let routePaths = new Set()
let routeRegister = 0
for (const f of walk(ROOT)) {
  let t = ''
  try { t = readFileSync(f, 'utf8') } catch { continue }
  for (const m of t.matchAll(/name:\s*'(memory_[a-z_]+)'/g)) toolNames.add(m[1])
  // 数注册调用，不数 path 字符串——有 3 条路由的 path 不是 '/consciousness' 开头，正则会漏。
  for (const _m of t.matchAll(/webServer\.register\(/g)) routeRegister++
}

// 识海数据
const seaDir = join(homedir(), '.dsh', 'consciousness-seas')
let seas = 0, points = 0, alive = 0, archived = 0, edges = 0
if (existsSync(seaDir)) {
  for (const name of readdirSync(seaDir)) {
    const p = join(seaDir, name, 'data.json')
    if (!existsSync(p)) continue
    seas++
    try {
      const d = JSON.parse(readFileSync(p, 'utf8'))
      const pts = d.points || []
      points += pts.length
      alive += pts.filter((x) => !x.dead && !x.archived).length
      archived += pts.filter((x) => x.archived && !x.dead).length
      edges += (d.edges || d.links || []).length
    } catch {}
  }
}

const testDir = join(ROOT, 'test')
const tests = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).length : 0

const out = {
  tools: toolNames.size,
  toolNames: [...toolNames].sort(),
  routes: routeRegister,
  seas,
  points,
  alive,
  archived,
  edges,
  tests,
  at: new Date().toISOString(),
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out))
} else {
  console.log(`工具 ${out.tools} 个 · 路由 ${out.routes} 条 · 测试 ${out.tests} 份`)
  console.log(`识海 ${out.seas} 个 · 点 ${out.points} 个（在检索 ${out.alive} / 沉底 ${out.archived}）· 突触 ${out.edges} 根`)
}
