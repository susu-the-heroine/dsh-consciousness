/**
 * Markdown 镜像：把每条记忆写成能干瞪眼看的文件
 * ==============================================
 *
 * 2026-11-12：现在记忆只有插件能读，离了它就看不见。
 * 镜像把每条导出成 .md，带 front-matter，用记事本就能翻、能改。
 * 这一版只导出（不反向导入），导入要等"改了文件怎么同步回库"想清楚。
 *
 * 跑法：node scripts/md-mirror.mjs [sea] [--out 目录]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const oi = process.argv.indexOf('--out')
const outDir = oi >= 0 ? process.argv[oi + 1] : join(homedir(), '.dsh', 'consciousness-mirror', sea)

const src = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
if (!existsSync(src)) { console.log('没有 data.json'); process.exit(1) }
const data = JSON.parse(readFileSync(src, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

/** 正文指纹：判断文件是不是被人改过 */
function textHash(s) {
  return createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16)
}

/** 文件名里不能有的字符，换掉 */
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\n\r]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled'
}
const pad = (n) => String(n).padStart(4, '0')

if (existsSync(outDir)) {
  // 只清我们自己生成的 .md，别动别人放进去的东西
  for (const f of readdirSync(outDir)) if (f.endsWith('.md')) rmSync(join(outDir, f))
} else mkdirSync(outDir, { recursive: true })

let n = 0
for (const p of pts) {
  const fm = [
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
    ...(p.mergedFrom ? [`merged_from: ${JSON.stringify(p.mergedFrom.join(','))}`] : []),
    '---',
    '',
    ...(p.alias ? [`> 别人可能这样问：${p.alias}`, ''] : []),
    String(p.text || ''),
    '',
  ].join('\n')
  const file = join(outDir, `${pad(p.id)}-${safeName(p.title)}.md`)
  writeFileSync(file, fm, 'utf8')
  n++
}
console.log(`导出 ${n} 条到 ${outDir}`)

// 抽一条读回来，验格式
const files = readdirSync(outDir).filter((f) => f.endsWith('.md'))
const one = files[Math.floor(files.length / 2)]
const body = readFileSync(join(outDir, one), 'utf8')
const m = body.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
console.log('抽检:', one)
console.log('  front-matter 解析:', m ? '成功' : '失败', '· 正文', m ? m[2].trim().length : 0, '字')
console.log('  首行:', m ? m[2].trim().split('\n')[0].slice(0, 40) : '')
