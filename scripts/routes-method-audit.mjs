/**
 * 路由静态审计：哪些写动作没卡 POST
 * ================================
 *   node scripts/routes-method-audit.mjs
 *
 * 做法：把 routes.js 里每个 `action === 'xxx'` 的分支切出来，看它后面若干行里
 * 有没有 `req.method` 的检查。名字像写的（set/add/del/run/merge/forget…）却没检查，
 * 就是这个脚本要报的——GET 也能改数据，缓存/预取/爬虫都能踩。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：跟真库那道闸同一个病——按「当前目录」找文件，换个目录一跑就 ENOENT，
// 退出码一、什么都没审。改成按本文件所在位置找。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'lib', 'routes.js'), 'utf8').split('\n')
const WRITE_ISH = /^(set|add|del|delete|remove|run|write|save|merge|forget|archive|restore|reset|clear|rebuild|apply|fix|import|export|level|bind|unbind|judge|rate|touch|update|put|post|sync|sweep|prune|migrate)/i

const findings = []
const all = []
for (let i = 0; i < src.length; i++) {
  const m = src[i].match(/action === '([a-zA-Z0-9_-]+)'/)
  if (!m) continue
  const name = m[1]
  const ahead = src.slice(i, Math.min(src.length, i + 40)).join('\n')
  const guarded = /req\.method|method !==|405/.test(ahead)
  all.push({ name, guarded })
  if (!guarded && WRITE_ISH.test(name)) findings.push({ name, line: i + 1 })
}

// 2026-11-20：路由表那种写法（path + handler）以前扫不到——删除路由就是这么漏的。
// 这里补一遍：写动作路径必须在 handler 里卡 POST。
const WRITE_PATH = /delete|remove|add|set|write|run|sweep|restore|merge|import|apply|rebuild|backfill|reset|clear/i
const pathFindings = []
let pathCount = 0
for (let i = 0; i < src.length; i++) {
  const m = src[i].match(/path: '([^']+)'/)
  if (!m) continue
  pathCount++
  const ahead = src.slice(i, Math.min(src.length, i + 40)).join('\n')
  if (WRITE_PATH.test(m[1]) && !/req\.method/.test(ahead)) pathFindings.push({ name: m[1], line: i + 1 })
}
if (pathFindings.length) {
  console.log('路由表里像写、但 handler 没卡方法的：')
  for (const f of pathFindings) console.log(`  · ${f.name}（routes.js:${f.line}）`)
} else {
  console.log(`路由表 ${pathCount} 条：写动作都卡了方法。`)
}

console.log(`共 ${all.length} 个 action 分支，其中带方法检查的 ${all.filter((x) => x.guarded).length} 个。`)
if (findings.length) {
  console.log('名字像写、但附近没看到方法检查的：')
  for (const f of findings) console.log(`  · ${f.name}（routes.js:${f.line}）`)
} else {
  console.log('没有发现「像写却不卡方法」的分支。')
}
process.exit(findings.length || pathFindings.length ? 1 : 0)
