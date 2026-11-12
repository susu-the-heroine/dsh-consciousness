/**
 * 短剧式台词：中文原创网文的对话
 * ============================
 * 短剧的台词基本都从爽文里来：短、带钩子、一句一个态度。
 * 源：vangogh0318/NovelConversationCorpus（开源，120 部中文网络小说的对话提取）
 *
 * 只取短句（6~40 字），因为要补的就是"短句里的语感"。
 * 输出：~/.dsh/记忆/_外人语料.jsonl（domain=网文）
 * 跑法：node scripts/fetch-webnovel.mjs [文件数]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = join(homedir(), '.dsh', '记忆', '_外人语料.jsonl')
const N = Number(process.argv[2]) || 6
const REPO = 'vangogh0318/NovelConversationCorpus'
const BR = 'master'
const H = { 'user-agent': 'dsh-agent', accept: 'application/vnd.github+json' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SKIP = /乳|胸|舔|插进|脱光|勃起|下体|射精|淫|裸/

const tr = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BR}?recursive=1`, { headers: H })).json()
const files = (tr.tree || [])
  .filter((x) => x.type === 'blob' && x.path.endsWith('.txt'))
  .sort((a, b) => a.size - b.size)
  .slice(0, N)
console.log('挑最小的', files.length, '个文件：', files.map((f) => (f.size / 1024).toFixed(0) + 'KB').join(' '))

const all = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean) : []
// 上一次把 GBK 当 UTF-8 读，进了 137 条乱码，清掉重来
const existed = all.filter((l) => {
  try { const o = JSON.parse(l); return o.domain !== '网文' } catch { return false }
})
if (all.length !== existed.length) console.log('清掉上次乱码', all.length - existed.length, '条')
const seen = new Set()
for (const l of existed) { try { seen.add(JSON.parse(l).text) } catch {} }

const fresh = []
for (const f of files) {
  try {
    const url = `https://raw.githubusercontent.com/${REPO}/${BR}/${f.path.split('/').map(encodeURIComponent).join('/')}`
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
    if (!r.ok) { console.log('  跳过', f.path, r.status); continue }
    const buf = new Uint8Array(await r.arrayBuffer())
    let text = new TextDecoder('utf-8').decode(buf)
    const bad = (text.match(/\uFFFD/g) || []).length
    if (bad > 20) {
      try { text = new TextDecoder('gbk').decode(buf) } catch {}
    }
    let added = 0
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      // 对话语料里一行就是一句台词；去掉名字前缀「张三：」
      const body = line.replace(/^[\u4e00-\u9fa5A-Za-z・]{1,8}[：:]\s*/, '').replace(/^[「“](.*)[」”]$/, '$1').trim()
      const n = [...body].length
      if (n < 6 || n > 40) continue
      if (SKIP.test(body)) continue
      if (!/[\u4e00-\u9fa5]/.test(body)) continue
      if (seen.has(body)) continue
      seen.add(body)
      fresh.push({ text: body, from: 'novel', domain: '网文', src: f.path })
      added++
    }
    console.log('  ' + f.path + '  新增 ' + added)
    await sleep(150)
  } catch (e) { console.log('  失败', f.path, e.message) }
}

mkdirSync(join(homedir(), '.dsh', '记忆'), { recursive: true })
writeFileSync(OUT, existed.concat(fresh.map((x) => JSON.stringify(x))).join('\n') + '\n', 'utf8')
console.log('\n新增短句', fresh.length, '条｜库里总共', existed.length + fresh.length)
console.log('样例：')
for (const x of fresh.slice(0, 15)) console.log('  · ' + x.text)
