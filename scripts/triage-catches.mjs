/**
 * 空 catch triage：把「其他」那三百多处按上下文重新分一次。
 * ==========================================
 * 规则（写死，别凭感觉）：
 *   看 try 块里那一行和上下两行里有没有这些动作——
 *   写：writeFileSync / writeSync / appendFileSync / renameSync / copyFileSync / rmSync / unlinkSync / truncateSync
 *   读：readFileSync / JSON.parse / statSync / existsSync
 *   时间：Date.now / new Date / setTimeout / setInterval
 *   日志/审计：audit( / appendBounded( / console.
 *   其余归「别的」。
 * 输出：每一类各多少条，以及「写」那类逐条列出来（那是要人看的）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(ROOT, 'lib')
const P = {
  写: /writeFileSync|writeSync|appendFileSync|renameSync|copyFileSync|rmSync|unlinkSync|truncateSync/,
  读: /readFileSync|JSON\.parse|statSync|existsSync|readdirSync/,
  时间: /Date\.now|new Date|setTimeout|setInterval/,
  记账: /audit\(|appendBounded\(|console\./,
}
const rows = []
for (const f of readdirSync(libDir).filter((x) => x.endsWith('.js'))) {
  const lines = readFileSync(join(libDir, f), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/.test(lines[i])) continue
    const ctx = lines.slice(Math.max(0, i - 2), i + 1).join('\n')
    let tag = '别的'
    for (const k of ['写', '读', '时间', '记账']) if (P[k].test(ctx)) { tag = k; break }
    rows.push({ f, line: i + 1, tag, text: lines[i].trim().slice(0, 90) })
  }
}
const by = {}
for (const r of rows) by[r.tag] = (by[r.tag] || 0) + 1
console.log('空 catch 共 ' + rows.length + ' 处，按上下文分：' + JSON.stringify(by))
const writes = rows.filter((r) => r.tag === '写')
console.log('\n「写」这一类 ' + writes.length + ' 处（这些要逐条看）：')
for (const w of writes) console.log('  ' + w.f + ':' + w.line + '  ' + w.text)