import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(ROOT, 'lib')
const P = /writeFileSync|writeSync|appendFileSync|renameSync|copyFileSync|rmSync|unlinkSync|truncateSync|readFileSync|JSON\.parse|statSync|existsSync|readdirSync|Date\.now|new Date|setTimeout|setInterval|audit\(|appendBounded\(|console\./
const rows = []
for (const f of readdirSync(libDir).filter((x) => x.endsWith('.js'))) {
  const lines = readFileSync(join(libDir, f), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/.test(lines[i])) continue
    const ctx = lines.slice(Math.max(0, i - 2), i + 1).join('\n')
    if (P.test(ctx)) continue
    rows.push({ f, line: i + 1, text: lines[i].trim().slice(0, 90), prev: lines[i - 1] ? lines[i - 1].trim().slice(0, 70) : '' })
  }
}
const byFile = {}
for (const r of rows) byFile[r.f] = (byFile[r.f] || 0) + 1
console.log('「别的」共 ' + rows.length + ' 处，按文件：')
for (const [k, v] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log('  ' + k + '：' + v)
console.log('\n抽查十二处（看上下文里在干什么）：')
const step = Math.max(1, Math.floor(rows.length / 12))
for (let i = 0; i < rows.length && i / step < 12; i += step) {
  const r = rows[i]
  console.log('  ' + r.f + ':' + r.line + '  上一行「' + r.prev + '」 → ' + r.text)
}
const out = ['# 空 catch · 「别的」那一类（2026-11-21）', '', '规则：上下两行里既没有写盘、也没有读盘、也没有时间、也没有记账的 catch。', '', '共 ' + rows.length + ' 处。按文件：', '']
for (const [k, v] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) out.push('- ' + k + '：' + v + ' 处')
out.push('', '## 逐条', '')
for (const r of rows) out.push('- `' + r.f + ':' + r.line + '` — 上下文里没有写/读/时间/记账动作，判轻')
writeFileSync(join(ROOT, 'docs', '空catch-别的-清单.md'), out.join('\n'), 'utf8')
console.log('\n写成 docs/空catch-别的-清单.md')