/**
 * 把记忆导出成 Markdown（纯文本镜像）
 * ==================================
 *
 * 2026-11-12：给用户一个"记忆能拿在手里"的出口。默认只读，不反向写。
 * 这里只负责导出，路径和格式固定：
 *   ~/.dsh/consciousness-mirror/<识海名>/<编号>-<标题>.md
 *
 * 一条记忆一个文件，front-matter 里带编号、别名、类型、重要度、情绪、分类、实体。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
const MIRROR = join(homedir(), '.dsh', 'consciousness-mirror')

function textHash(s) {
  return createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16)
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\n\r]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled'
}

/** 导出；返回 { ok, n, dir } */
export function exportMirror(sea = 'main') {
  const src = join(SEAS, sea, 'data.json')
  if (!existsSync(src)) return { ok: false, err: '这个识海还没有数据' }
  const data = JSON.parse(readFileSync(src, 'utf8').replace(/^\uFEFF/, ''))
  const pts = (data.points || []).filter((p) => !p.dead)
  const outDir = join(MIRROR, sea)

  if (existsSync(outDir)) {
    // 只清自己生成的 .md，别动用户往这个目录里放的东西
    for (const f of readdirSync(outDir)) if (f.endsWith('.md')) rmSync(join(outDir, f))
  } else mkdirSync(outDir, { recursive: true })

  let n = 0
  for (const p of pts) {
    const body = [
      '---',
      `id: ${p.id}`,
      `title: ${JSON.stringify(String(p.title || ''))}`,
      `alias: ${JSON.stringify(String(p.alias || ''))}`,
      `kind: ${p.kind || 'feeling'}`,
      `imp: ${p.imp ?? 0.6}`,
      `arousal: ${p.arousal ?? 0}`,
      `polarity: ${p.polarity ?? 0}`,
      `born: ${p.born || ''}`,
      `strength: ${p.strength ?? ''}`,
      `layer: ${p.layer || ''}`,
      `era: ${p.era || ''}`,
      `category: ${JSON.stringify(Array.isArray(p.category) ? p.category.join('、') : String(p.category || ''))}`,
      `entities: ${JSON.stringify(Array.isArray(p.entities) ? p.entities.join('、') : String(p.entities || ''))}`,
      `text_hash: ${textHash(p.text)}`,
      `open: ${p.open === true ? 'true' : 'false'}`,
      `rule: ${p.rule === true ? 'true' : 'false'}`,
      '---',
      '',
      ...(p.alias ? [`> 别人可能这样问：${p.alias}`, ''] : []),
      String(p.text || ''),
      '',
    ].join('\n')
    writeFileSync(join(outDir, `${String(p.id).padStart(4, '0')}-${safeName(p.title)}.md`), body, 'utf8')
    n++
  }
  return { ok: true, n, dir: outDir }
}
