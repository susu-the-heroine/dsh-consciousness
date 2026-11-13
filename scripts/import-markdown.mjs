/**
 * 把 memory_export 导出的 Markdown 读回来。
 *
 * 为什么要有：现在只能导出，导不回来。人不敢把重要东西交给一个拿不走的地方。
 *
 * 用法：
 *   node scripts/import-markdown.mjs --src <导出的目录> --out <写到哪里> [--json]
 *
 * 只读源目录、只写目标目录，绝不碰真实识海。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const get = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const SRC = get('--src')
const OUT = get('--out')
if (!SRC || !OUT) {
  console.error('用法：node scripts/import-markdown.mjs --src <目录> --out <输出目录> [--json]')
  process.exit(2)
}

/** 解析一份导出的 md：front-matter 是键值对，正文第一条 > 是别名提示，剩下是正文 */
function parseOne(raw) {
  const t = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return null
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    meta[k] = v
  }
  let body = t.slice(m[0].length)
  const lines = body.split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  if (lines[0] && lines[0].startsWith('>')) lines.shift()   // 别名提示行，别名已在 front-matter 里
  body = lines.join('\n').trim()

  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  const bool = (v) => v === 'true'

  if (!meta.title) return null
  return {
    id: num(meta.id, 0),
    title: meta.title,
    alias: meta.alias || '',
    kind: meta.kind || 'fact',
    imp: num(meta.imp, 0.6),
    arousal: meta.arousal === undefined ? undefined : num(meta.arousal, 0),
    polarity: meta.polarity === undefined ? undefined : num(meta.polarity, 0),
    born: num(meta.born, Date.now()),
    strength: num(meta.strength, 0),
    layer: meta.layer || 'core',
    era: meta.era || '',
    category: meta.category ? meta.category.split(/[、,]/).map((s) => s.trim()).filter(Boolean) : [],
    entities: meta.entities ? meta.entities.split(/[、,]/).map((s) => s.trim()).filter(Boolean) : [],
    text_hash: meta.text_hash || '',
    open: bool(meta.open),
    rule: bool(meta.rule),
    text: body,
  }
}

const files = existsSync(SRC)
  ? readdirSync(SRC).filter((f) => f.endsWith('.md')).sort()
  : []

const points = []
const skipped = []
for (const f of files) {
  try {
    const p = parseOne(readFileSync(join(SRC, f), 'utf8'))
    if (p) points.push(p)
    else skipped.push(f + '（没有 front-matter 或没有标题）')
  } catch (e) {
    skipped.push(f + '（' + e.message + '）')
  }
}

const data = { version: 1, points, edges: [] }
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'data.json'), JSON.stringify(data), 'utf8')

const out = { files: files.length, imported: points.length, skipped: skipped.length, skippedList: skipped.slice(0, 10) }
if (args.includes('--json')) console.log(JSON.stringify(out))
else {
  console.log(`读 ${out.files} 份，进 ${out.imported} 条，丢 ${out.skipped} 份`)
  if (out.skipped) console.log('丢的：' + out.skippedList.join('；'))
}
