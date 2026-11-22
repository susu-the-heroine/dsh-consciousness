/**
 * 打包完整性：入口引用的东西，包里有吗
 * ==================================
 *
 *   node scripts/pack-graph-test.mjs
 *
 * 为什么要有：`package.json` 的 `files` 是白名单——不在里面的东西，装到别人机器上就是不存在。
 * 本地怎么跑都好好的，别人一装就 404/MODULE_NOT_FOUND，而且他没法自己修。
 *
 * 这个脚本从 index.js / client.js 出发，顺着 import 把本地模块走一遍，再查 assets 里被代码引用的路径，
 * 最后挨个对 `files` 白名单。只读，不打包、不联网。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const files = Array.isArray(pkg.files) ? pkg.files : []

const problems = []
const seen = new Set()

function pkgHas(relPath) {
  const norm = relPath.replace(/\\/g, '/')
  return files.some((f) => {
    const f2 = String(f).replace(/\\/g, '/')
    return norm === f2 || norm.startsWith(f2 + '/')
  })
}

function checkFile(abs) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  if (seen.has(rel)) return
  seen.add(rel)
  if (!existsSync(abs)) { problems.push(`缺文件：${rel}`); return }
  if (!pkgHas(rel)) problems.push(`不在 files 白名单：${rel}`)
  if (!/\.(js|mjs)$/.test(abs)) return
  let src = ''
  try { src = readFileSync(abs, 'utf8') } catch { return }
  // 只认相对路径的 import / 动态 import；裸包名（零依赖）不用管
  const specs = new Set()
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) specs.add(m[1])
  for (const s of specs) {
    // 有的动态 import 带缓存戳：'./vectors.js?v=' —— 不是文件路径的一部分，先切掉
    const clean = s.split('?')[0]
    let target = join(dirname(abs), clean)
    if (!existsSync(target) && existsSync(target + '.js')) target += '.js'
    if (!existsSync(target) && existsSync(join(target, 'index.js'))) target = join(target, 'index.js')
    if (!existsSync(target)) { problems.push(`${rel} 引用了不存在的东西：${clean}`); continue }
    if (statSync(target).isDirectory()) {
      // 目录引用（比如 import './assets')：把里面的文件都算上
      for (const f of readdirSync(target)) checkFile(join(target, f))
    } else checkFile(target)
  }
}

// 1. 入口
for (const entry of ['index.js', 'client.js', 'selfupdate.mjs', 'scripts/count.mjs']) {
  if (existsSync(join(ROOT, entry))) checkFile(join(ROOT, entry))
  else problems.push(`入口不存在：${entry}`)
}

// 2. assets 里那些被代码按名字引用的目录（示例海、模型、词典、页面）
for (const p of ['assets/samples', 'assets/词典.txt', 'assets/意识海.html', 'assets/skin.js', 'lib']) {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) { problems.push(`资源不存在：${p}`); continue }
  if (statSync(abs).isDirectory()) {
    for (const f of readdirSync(abs)) {
      const a2 = join(abs, f)
      if (statSync(a2).isDirectory()) {
        if (!pkgHas(relative(ROOT, a2))) problems.push(`不在 files 白名单（目录）：${relative(ROOT, a2)}`)
      } else checkFile(a2)
    }
  } else checkFile(abs)
}

console.log(`扫了 ${seen.size} 个文件 · files 白名单 ${files.length} 项 · 问题 ${problems.length}`)
for (const p of problems.slice(0, 20)) console.log('  · ' + p)
if (problems.length > 20) console.log(`  …… 还有 ${problems.length - 20} 条`)
console.log(problems.length ? '包不完整，别人装上去会缺东西。' : '入口能引到的东西都在包里。')
process.exit(problems.length ? 1 : 0)
