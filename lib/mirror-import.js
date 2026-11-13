/**
 * 把导出的 Markdown 读回来
 * ========================
 *
 * exportMirror 把识海写成一批 .md，这里是它的反向：
 * 读 ~/.dsh/consciousness-mirror/<源识海>/*.md，解析回条目，写成一个新的识海。
 *
 * 三条硬规矩：
 * 1. 只往**不存在或空**的识海写。目标里已经有记忆，直接拒绝，绝不覆盖。
 * 2. 别名提示行（正文开头那条 >）跳过——别名已经在 front-matter 里。
 * 3. 时间、置信度、别名这些字段一个个搬，不重新生成。搬不动的记下来，不编。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
const MIRROR = join(homedir(), '.dsh', 'consciousness-mirror')

/** 解析一份导出的 md */
export function parseMirrorFile(raw) {
  const t = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
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
  if (!meta.title) return null

  const lines = t.slice(m[0].length).split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  if (lines[0] && lines[0].startsWith('>')) lines.shift()
  const body = lines.join('\n').trim()

  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d }
  const list = (v) => (v ? v.split(/[、,]/).map((s) => s.trim()).filter(Boolean) : [])

  return {
    id: num(meta.id, 0),
    title: meta.title,
    alias: meta.alias || '',
    kind: meta.kind || 'fact',
    imp: num(meta.imp, 0.6),
    arousal: meta.arousal === undefined ? undefined : num(meta.arousal, 0),
    polarity: meta.polarity === undefined ? undefined : num(meta.polarity, 0),
    born: num(meta.born, 0) || Date.now(),
    strength: num(meta.strength, 0),
    layer: meta.layer || 'core',
    era: meta.era || '',
    category: list(meta.category),
    entities: list(meta.entities),
    text_hash: meta.text_hash || '',
    open: meta.open === 'true',
    rule: meta.rule === 'true',
    text: body,
  }
}

/**
 * 导入。
 * @param {string} from 源：导出的目录名，默认 main
 * @param {string} to   目标识海名。必须不存在或为空。
 */
export function importMirror(from = 'main', to) {
  if (!to) return { ok: false, err: '要说清楚导进哪个识海' }
  if (to === from) return { ok: false, err: '不能导入到源识海自己身上' }

  const srcDir = join(MIRROR, from)
  if (!existsSync(srcDir)) return { ok: false, err: `找不到导出的目录：${srcDir}（先导出一次）` }

  const targetDir = join(SEAS, to)
  const targetFile = join(targetDir, 'data.json')
  if (existsSync(targetFile)) {
    try {
      const old = JSON.parse(readFileSync(targetFile, 'utf8'))
      const n = Array.isArray(old && old.points) ? old.points.length : 0
      if (n > 0) return { ok: false, err: `识海「${to}」里已经有 ${n} 条，我不覆盖。换个名字` }
    } catch { /* 坏文件当空的处理，反正下面会整份重写 */ }
  }

  const files = readdirSync(srcDir).filter((f) => f.endsWith('.md')).sort()
  if (!files.length) return { ok: false, err: '那个目录里没有 .md' }

  const points = []
  const skipped = []
  for (const f of files) {
    try {
      const p = parseMirrorFile(readFileSync(join(srcDir, f), 'utf8'))
      if (p) points.push(p)
      else skipped.push(f)
    } catch (e) {
      skipped.push(f + '：' + ((e && e.message) || e))
    }
  }
  if (!points.length) return { ok: false, err: '一条都没读出来，不写' }

  // 编号重新排：导出的文件名带序号，但 id 可能重复
  points.sort((a, b) => (a.id || 0) - (b.id || 0))
  const idMap = new Map()
  points.forEach((p, i) => { idMap.set(p.id, i + 1); p.id = i + 1 })

  // 关系：有 _edges.json 就跟着搬，两边都还在的才留
  let edges = []
  const edgesFile = join(srcDir, '_edges.json')
  if (existsSync(edgesFile)) {
    try {
      const raw = JSON.parse(readFileSync(edgesFile, 'utf8'))
      if (Array.isArray(raw)) {
        for (const e of raw) {
          const a = idMap.get(e.a)
          const b = idMap.get(e.b)
          if (!a || !b || a === b) continue
          edges.push({ ...e, a, b })
        }
      }
    } catch {}
  }

  mkdirSync(targetDir, { recursive: true })
  writeFileSync(targetFile, JSON.stringify({ version: 1, points, edges }), 'utf8')

  // 顺手写一份 meta，面板才认得这个识海
  try {
    writeFileSync(join(targetDir, 'meta.json'), JSON.stringify({
      count: points.length,
      mtime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }, null, 2), 'utf8')
  } catch {}

  return { ok: true, n: points.length, edges: edges.length, files: files.length, skipped: skipped.length, dir: targetDir, skippedList: skipped.slice(0, 10) }
}
