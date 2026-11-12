/**
 * 一键自检：把散在各处的验证一次跑完
 * ==================================
 *
 * 2026-11-12 一天里改了写入链路、双写、镜像导出、工具注册、候选路径。
 * 这些各自都有自测，但散在五六个脚本里，容易漏跑。
 * 这个脚本只负责"叫齐"和"汇总"，不重复实现任何检查。
 *
 * 跑法：node scripts/selftest-all.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath

const suites = [
  { name: '写入链路（21 项）', script: 'writer-verify.mjs', args: [] },
  { name: '词闸（5 项）', script: 'gate-selftest.mjs', args: [] },
  { name: 'SQLite 镜像（8 项）', script: 'sqlite-mirror-test.mjs', args: [] },
  { name: '候选两路（6 项）', script: 'candidates-test.mjs', args: ['main'] },
  { name: 'JSON 与 SQLite 一致', script: 'sqlite-parity.mjs', args: ['main'] },
  // 情绪这一圈：本来就有，只是一直没人跑
  { name: '口语情绪判定', script: '../test/emotion-colloquial.test.mjs', args: [] },
  { name: '情绪同频', script: '../test/affinity.test.mjs', args: [] },
  { name: '情绪动力学（回落/阻尼）', script: '../test/dynamics.test.mjs', args: [] },
  { name: '情绪标签', script: '../test/labels.test.mjs', args: [] },
  { name: '共情', script: '../test/empathy.test.mjs', args: [] },
  { name: '自我状态', script: '../test/selfstate.test.mjs', args: [] },
]

// 文档结构（可选）：只在本机存在那份 docx 时跑。用 Python 做，因为 docx 包在 Python 那边。
const DOC = join(homedir(), "Desktop", "识海_项目说明材料.docx")

const results = []
for (const s of suites) {
  const f = join(HERE, s.script)
  if (!existsSync(f)) {
    results.push({ name: s.name, ok: false, note: '脚本不存在' })
    continue
  }
  const r = spawnSync(NODE, [f, ...s.args], { encoding: 'utf8', timeout: 600000 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const tail = out.trim().split(/\n/).slice(-1)[0] || ''
  const ok = r.status === 0
  results.push({ name: s.name, ok, note: tail.slice(0, 60) })
  console.log(`${ok ? '通过' : '失败'}  ${s.name}  ${tail.slice(0, 60)}`)
}

if (existsSync(DOC)) {
  const py = "C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe"
  const r = spawnSync(py, [join(HERE, "doc_check.py"), DOC], { encoding: "utf8", timeout: 300000 })
  const out = String(r.stdout || "") + String(r.stderr || "")
  const tail = out.trim().split(/\n/).slice(-1)[0] || ""
  const good = r.status === 0
  results.push({ name: "文档结构", ok: good, note: tail.slice(0, 60) })
  console.log(`${good ? "通过" : "失败"}  文档结构  ${tail.slice(0, 60)}`)
}

const bad = results.filter((r) => !r.ok)
console.log('')
console.log(`共 ${results.length} 组 · 通过 ${results.length - bad.length} · 失败 ${bad.length}`)
if (bad.length) {
  console.log('失败的有：')
  for (const b of bad) console.log('  · ' + b.name + ' → ' + b.note)
}
process.exit(bad.length ? 1 : 0)
