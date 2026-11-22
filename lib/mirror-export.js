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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
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
  // 坏库要报出来，不能抛到调用层——这个函数的约定一直是 {ok,err}。（2026-11-14 审计）
  let data
  try {
    data = JSON.parse(readFileSync(src, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    return { ok: false, err: 'data.json 读不出来：' + String((e && e.message) || e).slice(0, 60) }
  }
  const pts = (data.points || []).filter((p) => !p.dead)
  const outDir = join(MIRROR, sea)

  if (existsSync(outDir)) {
    // 只清自己生成的 .md，别动用户往这个目录里放的东西
    // 2026-11-20：清理也可能抛——同名位置被占成目录时 rm 会 EISDIR，
    // 一并按约定回 {ok,err}，别让导出在半路炸出去。
    // 2026-11-20 再收一层：同名位置是目录（不是文件）时，跳过它，别为它中断整次导出。
    // 上一次是按错误码判断的——Node 删目录抛的码不一定叫 EISDIR，判断没兜住。
    for (const f of readdirSync(outDir)) {
      if (!f.endsWith('.md')) continue
      const fp = join(outDir, f)
      try {
        if (!statSync(fp).isFile()) continue
        rmSync(fp, { force: true })
      } catch { /* 单个文件清不掉就留着，下一步写会覆盖它 */ }
    }
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
    // 2026-11-20：单条写失败原来是直接抛到调用层——这函数对外约定是 {ok,err}。
    // 目标被占成目录、权限不够，都该回一句人话，不是抛。
    try {
      writeFileSync(join(outDir, `${String(p.id).padStart(4, '0')}-${safeName(p.title)}.md`), body, 'utf8')
    } catch (e) {
      return { ok: false, err: '第 ' + p.id + ' 条写不出去：' + String((e && e.message) || e).slice(0, 60), n }
    }
    n++
  }
  // 关系带不走就白导了：md 里只有记忆自己，没有"谁连着谁"。
  // 单独写一份，两边 id 都在的才写。
  let edges = 0
  let _edgeWarn = ''
  try {
    const ids = new Set(pts.map((p) => p.id))
    const keep = (data.edges || []).filter((e) => ids.has(e.a) && ids.has(e.b))
    writeFileSync(join(outDir, '_edges.json'), JSON.stringify(keep), 'utf8')
    edges = keep.length
  } catch (e) {
    // 2026-11-21：边表写失败原来整段吞掉，导出照样报「成功 2 条、边 0」——
    // 上面每一条 md 写失败都会如实报错，偏偏关系这块不出声。实测：把 _edges.json 的位置占成目录，
    // 返回 ok 且 edges 为 0，那条关系就这么没了。现在把失败说出来。
    _edgeWarn = '关系表没写出去（这条海的连线会丢）：' + String((e && e.message) || e).slice(0, 80)
  }

  const _out = { ok: true, n, edges, dir: outDir }
  if (_edgeWarn) _out.warn = _edgeWarn
  return _out
}
