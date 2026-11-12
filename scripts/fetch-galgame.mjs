/**
 * 从剧本里抓「别人说的话」
 * ======================
 * 小说太文，台词才通俗。用开源 galgame 剧本科普：中文 4090 个剧本，全是对话体，
 * 三教九流、日常口吻、情绪齐全——这是补"广度"最省事的一处。
 *
 * 只取对白行，按长度筛，去重，落盘到 _外人语料.jsonl（domain=剧本）。
 * 跑法：node scripts/fetch-galgame.mjs [文件数]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT_DIR = join(homedir(), '.dsh', '记忆')
const OUT = join(OUT_DIR, '_外人语料.jsonl')
const N_FILES = Number(process.argv[2]) || 30
const REPO = 'm-rui001/galgame-script-corpus'
const BR = 'main'
const H = { 'user-agent': 'dsh-agent', accept: 'application/vnd.github+json' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 太露骨的行直接跳过（不是道德，是怕污染语感）
const SKIP = /乳|胸|舔|插进|脱光|勃起|下体|射|淫|裸/

function clean(s) {
  let t = String(s || '')
    .replace(/\\[a-zA-Z]+\[[^\]]*\]/g, '')
    .replace(/\[[^\]]{1,12}\]/g, '')
    .replace(/〈[^〉]*〉/g, '')
    .replace(/[（(][^）)]{0,20}[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const n = [...t].length
  if (n < 6 || n > 70) return ''
  if (SKIP.test(t)) return ''
  if (!/[\u4e00-\u9fa5]/.test(t)) return ''
  return t
}

// 真格式是「名字「台词」」，不带冒号；旁白是普通行。只留前者。
function extractDialogue(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // 名字「台词」
    let m = line.match(/^[\u4e00-\u9fa5A-Za-z・]{1,6}「(.+)」$/)
    if (!m) {
      // 无名提示语「台词」也算（是别人在说话）
      m = line.match(/^「(.+)」$/)
    }
    if (!m) continue
    const t = clean(m[1])
    if (t) out.push(t)
  }
  return out
}

const all = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean) : []
// 上一次把旁白当对白抓了 9382 条，先清掉重来
const existed = all.filter((l) => {
  try { return JSON.parse(l).domain !== '剧本' } catch { return false }
})
const purged = all.length - existed.length
if (purged) console.log('清掉上次误抓的', purged, '条')
const seen = new Set()
for (const l of existed) { try { seen.add(JSON.parse(l).text) } catch {} }

// 挑中等大小的中文剧本（太大下载慢，太小对白少）
const tr = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BR}?recursive=1`, { headers: H })).json()
const files = (tr.tree || [])
  .filter((x) => x.type === 'blob' && x.path.startsWith('Zh/') && x.path.endsWith('.txt'))
  .filter((x) => x.size > 40000 && x.size < 400000)
  .slice(0, N_FILES)
console.log('挑中剧本', files.length, '个')

const fresh = []
let scanned = 0
for (const f of files) {
  try {
    const url = `https://raw.githubusercontent.com/${REPO}/${BR}/${f.path.split('/').map(encodeURIComponent).join('/')}`
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
    if (!r.ok) { console.log('  跳过', f.path, r.status); continue }
    const text = await r.text()
    scanned++
    const lines = extractDialogue(text)
    let added = 0
    for (const t of lines) {
      if (seen.has(t)) continue
      seen.add(t)
      fresh.push({ text: t, from: 'script', domain: '剧本', src: f.path.split('/').pop() })
      added++
    }
    console.log('  ' + String(f.path).slice(0, 46).padEnd(46) + ' 对白 ' + String(lines.length).padStart(4) + '｜新增 ' + added)
    await sleep(120)
  } catch (e) {
    console.log('  失败', f.path, e.message)
  }
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, existed.concat(fresh.map((x) => JSON.stringify(x))).join('\n') + '\n', 'utf8')
console.log('\n扫了', scanned, '个剧本｜新增对白', fresh.length, '条｜库里总共', existed.length + fresh.length, '条')
console.log('样例：')
for (const x of fresh.slice(0, 12)) console.log('  · ' + x.text)
