#!/usr/bin/env node
import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 发版前检查：一条命令跑完，任何一条不过就不许发。
 * 用法：node scripts/preflight.mjs
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fail = []
const ok = []
const warn = []

function check(name, fn) {
  try {
    const r = fn()
    // 2026-11-21：以前 undefined 也算过——哪个检查忘了写 return，就会静默变绿。
    // 现在只认明确的 true，其余一律当「没给出结论」。
    if (r === true) ok.push(name)
    else if (r === undefined) fail.push(name + ' — 这个检查没给出结论（忘了写 return？）')
    else if (typeof r === 'string' && r.startsWith('WARN:')) warn.push(name + ' — ' + r.slice(5))
    else fail.push(name + ' — ' + (typeof r === 'string' ? r : '未通过'))
  } catch (e) {
    fail.push(name + ' — ' + (e && e.message ? e.message : String(e)))
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

// 检索基准：三百多道真库题，头名/前五/前十任一掉两个点就挡（2026-11-18 夜）
check('检索基准不低于地板（三百二十九题）', () => {
  const out = execFileSync(_nodeBin, [path.join(root, 'scripts', 'bench-baseline.mjs'), '--json'], { encoding: 'utf8', timeout: 240000 })
  const line = String(out).trim().split('\n').filter((x) => x.startsWith('{')).pop()
  if (!line) return '基准没回数'
  const r = JSON.parse(line)
  const floorPath = path.join(root, 'scripts', 'data', 'baseline', 'floor.json')
  if (!fs.existsSync(floorPath)) return 'WARN:还没有地板，先跑一次 bench-baseline'
  const floor = JSON.parse(fs.readFileSync(floorPath, 'utf8'))
  if (!(Number(r.n) >= 300)) return '题数不够：' + r.n
  const bad = []
  if (Number(r.top1) < Number(floor.top1)) bad.push('头名 ' + r.top1 + '% < ' + floor.top1 + '%')
  if (Number(r.top5) < Number(floor.top5)) bad.push('前五 ' + r.top5 + '% < ' + floor.top5 + '%')
  if (Number(r.top10) < Number(floor.top10)) bad.push('前十 ' + r.top10 + '% < ' + floor.top10 + '%')
  return bad.length ? '低于地板：' + bad.join(' · ') : true
})

check('打出来的包比所有源文件都新', () => {
  const tgz = path.join(os.homedir(), 'Desktop', '识海发版', `dsh-consciousness2-${pkg.version}-code.tgz`)
  if (!fs.existsSync(tgz)) return 'WARN:还没打包'
  const packAt = fs.statSync(tgz).mtimeMs
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'node_modules' || e.name === 'data' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])
  const stale = walk(root)
    .filter((f) => /\.(m?js|md|json|html|yml|ps1)$/.test(f))
    // 这两支是打包/检查自己，改完它们要先跑一次打包才轮得到这条判据
    .filter((f) => !/scripts[\\/](preflight|pack-split)\.mjs$/.test(f))
    // 2026-11-21：原来拿整个仓库比——连测试脚本、临时稿都算进「改了没重打」，
    // 可它们根本不在包里。只比 package.json 的 files 里列到的那些。
    .filter((f) => {
      const rel = path.relative(root, f).replace(/\\/g, '/')
      if (rel === 'package.json') return true
      return (pkg.files || []).some((e) => rel === e || rel.startsWith(e.replace(/\/$/, '') + '/'))
    })
    .filter((f) => fs.statSync(f).mtimeMs > packAt)
  return stale.length ? '改了没重打：' + stale.slice(0, 3).map((f) => path.basename(f)).join(', ') : true
})

check('打出来的包解开来每个脚本都能过语法', () => {
  const tgz = path.join(os.homedir(), 'Desktop', '识海发版', `dsh-consciousness2-${pkg.version}-code.tgz`)
  if (!fs.existsSync(tgz)) return 'WARN:还没打包，先跑一次 pack-split'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-parse-'))
  try {
    execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'ignore' })
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
    const files = walk(path.join(tmp, 'package')).filter((f) => /\.(mjs|js)$/.test(f))
    const bad = []
    for (const f of files) {
      try { execFileSync(_nodeBin, ['--check', f], { stdio: 'ignore' }) } catch { bad.push(path.basename(f)) }
    }
    return bad.length ? '解开来有 ' + bad.length + ' 个脚本过不了语法：' + bad.slice(0, 3).join(', ') : true
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

check('版本号格式是十进制三段', () => /^\d+\.\d+\.\d+$/.test(pkg.version) || '现在写的是 ' + pkg.version)

check('files 里每一项都真实存在', () => {
  const miss = (pkg.files || []).filter(f => !fs.existsSync(path.join(root, f)))
  return miss.length === 0 || '缺：' + miss.join(', ')
})

check('必需文件都在 files 里', () => {
  const need = ['index.js', 'client.js', 'cordis.patch.yml', 'assets', 'lib', 'README.md']
  const have = new Set(pkg.files || [])
  const miss = need.filter(n => !have.has(n))
  return miss.length === 0 || 'files 少了：' + miss.join(', ')
})

check('包里没有备份文件', () => {
  // 2026-11-21：这条原来把整个源码树扫一遍——本地留的 .bak 文件夹（没在 files 里、根本不会进包）
  // 也会被判成「混进去了」，于是发版闸门永远红着。改成只看 files 里列到的东西。
  const bad = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.bak|__pycache__|\.pyc$/.test(e.name)) bad.push(path.relative(root, p))
    }
  }
  for (const f of (pkg.files || [])) {
    const full = path.join(root, f)
    if (!fs.existsSync(full)) continue
    if (fs.statSync(full).isDirectory()) walk(full)
    else if (/\.bak|__pycache__|\.pyc$/.test(path.basename(full))) bad.push(f)
  }
  return bad.length === 0 || '混进去了 ' + bad.length + ' 个：' + bad.slice(0, 5).join(', ')
})

check('CHANGELOG 顶部就是这个版本', () => {
  const p = path.join(root, 'CHANGELOG.md')
  if (!fs.existsSync(p)) return '没有 CHANGELOG.md'
  const head = fs.readFileSync(p, 'utf8').split('\n').slice(0, 6).join('\n')
  return head.includes(pkg.version) || 'CHANGELOG 顶部没写 ' + pkg.version
})

check('页面脚本语法', () => {
  const p = path.join(root, 'assets', '意识海.html')
  const html = fs.readFileSync(p, 'utf8')
  const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
  const bad = []
  blocks.forEach((code, i) => {
    try { new Function(code) } catch (e) { bad.push('第 ' + (i + 1) + ' 段: ' + e.message) }
  })
  return bad.length === 0 || bad.join(' | ')
})

check('页面引用的本地资源都在', () => {
  const p = path.join(root, 'assets', '意识海.html')
  const html = fs.readFileSync(p, 'utf8')
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']/g)].map(m => m[1])
  const bad = refs.filter(r => {
    if (/^(https?:|data:|\/\/|javascript)/.test(r)) return false
    if (r.startsWith('/consciousness')) return false   // 服务端路由，不是文件
    return !fs.existsSync(path.join(root, 'assets', r))
  })
  return bad.length === 0 || '缺：' + bad.join(', ')
})

check('插件脚本语法（node --check）', () => {
  const files = ['index.js', 'client.js', 'selfupdate.mjs']
  const bad = []
  for (const f of files) {
    if (!fs.existsSync(path.join(root, f))) continue
    try {
      execFileSync(_nodeBin, ['--check', path.join(root, f)], { stdio: 'ignore' })
    } catch { bad.push(f) }
  }
  return bad.length === 0 || '语法不过：' + bad.join(', ')
})

check('profile 启用清单里有本插件', () => {
  const prof = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'package.json')
  if (!fs.existsSync(prof)) return 'WARN: 没找到 desktop profile，跳过'
  const j = JSON.parse(fs.readFileSync(prof, 'utf8'))
  const b = (((j.dsh || {}).profile || {}).bundles) || []
  return b.includes(pkg.name) ? true : '没启用（bundles 里没有 ' + pkg.name + '）——装了也不会出现在界面上'
})

check('依赖是空的（零安装）', () => {
  const d = pkg.dependencies || {}
  const n = Object.keys(d).length
  return n === 0 ? true : 'WARN: 有 ' + n + ' 个依赖，装的时候会拉包'
})

const line = '─'.repeat(46)
console.log(line)
console.log('识海 ' + pkg.version + ' 发版前检查')
console.log(line)
ok.forEach(x => console.log('  过  ' + x))
warn.forEach(x => console.log('  注意 ' + x))
fail.forEach(x => console.log('  不过 ' + x))
console.log(line)
if (fail.length) {
  console.log('不合格 ' + fail.length + ' 项，不许发。')
  process.exit(1)
}
console.log('全过，可以发。')
