/**
 * 日志别无限长
 * ============
 *
 *   node scripts/logfile-test.mjs
 *
 * 往一个临时文件里猛写，看它会不会自己收着：
 *  - 文件不会超过上限太多（实测按 1.1 倍判；头里原来写 1.5，说的是另一回事）
 *  - 收的时候不从半行切开（切过之后 JSON 解析全废）
 *  - 收过一次就留一份 .1，能查旧账
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const L = await import('file:///' + join(HERE, '..', 'lib', 'logfile.js').replace(/\\/g, '/'))

const dir = mkdtempSync(join(tmpdir(), 'c2-log-'))
const file = join(dir, 'x.log')
const max = 4000
const line = JSON.stringify({ t: Date.now(), pad: 'x'.repeat(40) }) + '\n'

let rotated = 0
for (let i = 0; i < 600; i++) {
  const r = L.appendBounded(file, line, max)
  if (r && r.rotated) rotated++
}

const size = statSync(file).size
const raw = readFileSync(file, 'utf8')
const lines = raw.split('\n').filter(Boolean)
const allParse = lines.every((l) => { try { JSON.parse(l); return true } catch { return false } })
const hasBak = existsSync(file + '.1')

console.log(`写了 ${600} 行 · 收过 ${rotated} 次 · 现在 ${size} 字节（上限 ${max}）· 每行都能解析 ${allParse ? '是' : '不是'} · 有 .1 ${hasBak ? '有' : '没有'}`)

// 第三件：只读尾巴能不能拿到最后一行（日志再大也只读 8KB）
import { writeFileSync } from 'node:fs'
const big = join(dir, 'big.log')
const rows = []
for (let i = 0; i < 60000; i++) rows.push(JSON.stringify({ t: i, id: i }))
writeFileSync(big, rows.join('\n') + '\n', 'utf8')
const t0 = Date.now()
const last = L.readLastLine(big)
const tailMs = Date.now() - t0
const tailOk = Boolean(last && Number(last.id) === 59999)
console.log(`只读尾巴：${statSync(big).size} 字节 · 耗时 ${tailMs}ms · 最后一行 id=${last ? last.id : 'null'}（应为 59999）`)

const ok = size <= max * 1.1 && allParse && rotated >= 1 && tailOk
rmSync(dir, { recursive: true, force: true })
console.log(ok ? '日志会自己收着，不切半行。' : '不对：日志要么没上限，要么把行切坏了。')
process.exit(ok ? 0 : 1)
