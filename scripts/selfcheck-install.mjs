/**
 * 装机自检：装完到底能不能用
 * ========================
 *
 * 只读检查，能修的只修自己该修的（建目录），不碰用户配置。
 * 查七件：
 *   1. 版本与零依赖
 *   2. profile 启用清单里有没有本插件（上次整站 404 的真凶）
 *   3. 模块能加载、工具数对不对（二十三件）
 *   4. 路由入口在
 *   5. 数据目录可写（没有就建）
 *   6. 主海能读、条数
 *   7. 上次加载错误日志（有就报最后一行）
 *
 * 跑法：node scripts/selfcheck-install.mjs
 * 退出码：有 FAIL 为 1，只有 WARN 为 0。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOME = process.env.USERPROFILE || homedir()
const DSH = join(HOME, '.dsh')
const out = []
let fail = 0
let warn = 0
const pass = (m) => out.push('PASS  ' + m)
const warnf = (m) => { warn++; out.push('WARN  ' + m) }
const failf = (m) => { fail++; out.push('FAIL  ' + m) }

// 1. 版本与零依赖
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  pass(`版本 ${pkg.version}（${pkg.name}）`)
  const deps = Object.keys(pkg.dependencies || {})
  if (deps.length) failf(`有运行时依赖：${deps.join(', ')}（应当零依赖）`)
  else pass('零依赖')
} catch (e) {
  failf('package.json 读不了：' + e.message)
}

// 2. profile 启用清单
try {
  const pdir = join(DSH, 'profiles')
  if (!existsSync(pdir)) {
    warnf('没有 profiles 目录（全新机器，装完插件再来查）')
  } else {
    const profiles = readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory())
    if (!profiles.length) warnf('profiles 下没有档案')
    for (const d of profiles) {
      const f = join(pdir, d.name, 'package.json')
      if (!existsSync(f)) { warnf(`档案 ${d.name} 没有 package.json`); continue }
      let bundles = []
      try { bundles = JSON.parse(readFileSync(f, 'utf8')).dsh?.profile?.bundles || [] } catch {}
      if (bundles.includes('dsh-consciousness2')) pass(`档案 ${d.name} 的启用清单里有 dsh-consciousness2`)
      else failf(`档案 ${d.name} 的启用清单里没有 dsh-consciousness2——装上也不会出现在界面（上次整站 404 就是这个）。手动补：在 dsh.profile.bundles 里加 "dsh-consciousness2" 再重启。`)
    }
  }
} catch (e) {
  warnf('查启用清单出错：' + e.message)
}

// 3. 模块能加载、工具数
try {
  const T = await import(pathToFileURL(join(ROOT, 'lib', 'tools.js')).href + '?v=' + Date.now())
  const names = new Set()
  for (const f of ['tools.js', 'tools-think.js', 'tools-evolve.js', 'tools-uncertain.js']) {
    const M = await import(pathToFileURL(join(ROOT, 'lib', f)).href + '?v=' + Date.now())
    for (const v of Object.values(M)) {
      if (v && typeof v.name === 'string' && v.name.startsWith('memory_')) names.add(v.name)
    }
  }
  if (T && T.searchTool && typeof T.searchTool.execute === 'function') pass('检索工具在')
  else failf('检索工具没找到')
  if (names.size === 23) pass(`工具 ${names.size} 件，和文档一致`)
  else failf(`工具 ${names.size} 件，文档写的是 23 件`)
} catch (e) {
  failf('模块加载失败：' + (e && e.message))
}

// 4. 路由入口
try {
  const R = await import(pathToFileURL(join(ROOT, 'lib', 'routes.js')).href + '?v=' + Date.now())
  if (typeof R.mountRoutes === 'function') pass('路由入口 mountRoutes 在')
  else failf('路由入口不在')
} catch (e) {
  failf('路由模块加载失败：' + (e && e.message))
}

// 5. 数据目录
try {
  const seas = join(DSH, 'consciousness-seas')
  if (!existsSync(seas)) {
    mkdirSync(seas, { recursive: true })
    pass('数据目录原本没有，已建：' + seas)
  } else {
    pass('数据目录在：' + seas)
  }
} catch (e) {
  failf('数据目录建不了：' + e.message)
}

// 6. 主海
try {
  const f = join(DSH, 'consciousness-seas', 'main', 'data.json')
  if (!existsSync(f)) warnf('主海还没建（全新机器正常）')
  else {
    const d = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
    const n = (d.points || []).filter((p) => p && !p.dead).length
    pass(`主海可读：${n} 条`)
  }
} catch (e) {
  failf('主海坏了：' + e.message)
}

// 7. 上次加载错误
try {
  const f = join(DSH, 'consciousness-load-error.txt')
  if (existsSync(f)) {
    const lines = readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/)
    warnf('上次加载出过错，最后一行：' + (lines[lines.length - 1] || '').slice(0, 120))
  } else pass('没有加载错误记录')
} catch {}

console.log(out.join('\n'))
console.log(`—— 自检结束：FAIL ${fail} 个，WARN ${warn} 个 ——`)
process.exit(fail ? 1 : 0)
