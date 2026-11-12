/**
 * 消化：把生肉嚼成记忆
 * ====================
 * 群里那个「小胃」干的就是这件事：一段资料进来，不是原样存档，而是嚼碎、去重、
 * 挑出值得记的，写成第一人称的一条。
 *
 * 这一步以前靠手写。现在拆成两段：
 *   嚼（脚本）：切段、去掉复读、跟旧记忆比对、算重要性
 *   写（代理/人）：把嚼出来的那一句写成她自己的话，再 memory_add
 *
 * 这个脚本负责「嚼」，不负责「写」。
 *
 * 跑法：
 *   node scripts/digest.mjs <文本文件> [sea] [最多几条]
 * 产出：
 *   ~/.dsh/记忆/_待消化.jsonl   —— 嚼好的候选，等写
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const src = process.argv[2]
const sea = process.argv[3] || 'main'
const maxN = Math.max(1, Number(process.argv[4] || 12))
if (!src || !existsSync(src)) {
  console.error('用法：node scripts/digest.mjs <文本文件> [sea] [最多几条]')
  process.exit(1)
}

const base = 'file:///C:/Users/Administrator/.dsh/plugin-src/dsh-consciousness/'
const store = await import(base + 'lib/store.js')

const raw = readFileSync(src, 'utf8')
  .replace(/\r/g, '')
  .split('\n')
  .map((l) => l.trim())
  // 聊天导出每行都带时间戳和发话人。以前是把整行丢掉，结果一句不剩。
  .map((l) => l.replace(/^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*/, ''))
  .map((l) => l.replace(/^[^：:]{1,12}[：:]\s*/, ''))     // 剥掉「群主 苏苏侠：」
  .filter(Boolean)
  .filter((l) => !/^(图片|语音|表情)$/.test(l))

// 一句一句切，太短的并到上一句
const chunks = []
for (const l of raw) {
  if ([...l].length < 8 && chunks.length) chunks[chunks.length - 1] += ' ' + l
  else chunks.push(l)
}

const old = store.readSea(sea)
const oldText = (old && old.points ? old.points : []).map((p) => String(p.title || '') + String(p.text || '')).join('\n')

// 复读判断：跟已有记忆重合太多就丢掉
function grams(s) {
  const t = String(s || '').replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}
function overlap(a, b) {
  const A = grams(a)
  const B = grams(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / A.size
}

// 值得记的信号：具体的人/时间/情绪/约定/禁忌
const SIGNAL = [
  [/骂|火|气|崩|哭|怕|难受|委屈/, 3],
  [/答应|约定|说好|欠|兑现/, 3],
  [/以后|再也|永远|第一次|最后一次|那天|那晚/, 2],
  [/别|不许|不能|禁止|别提/, 2],
  [/\d{2,}|点|号|月|年/, 1],
  [/视频|剧本|素材|剪|配音|账号/, 1],
]

const scored = []
for (const c of chunks) {
  const len = [...c].length
  if (len < 6) continue
  if (overlap(c, oldText) > 0.6) continue          // 复读
  let s = 0
  for (const [re, w] of SIGNAL) if (re.test(c)) s += w
  s += Math.min(3, len / 40)                        // 长一点的信息量多一点
  if (s < 2) continue
  scored.push({ text: c, score: Number(s.toFixed(2)) })
}

scored.sort((a, b) => b.score - a.score)
const picked = scored.slice(0, maxN)

const outDir = join(homedir(), '.dsh', '记忆')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, '_待消化.jsonl')
writeFileSync(outFile, picked.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8')

console.log('切出', chunks.length, '段，去重后剩', scored.length, '段，挑出', picked.length, '段')
for (const p of picked.slice(0, 5)) console.log('  [' + p.score + '] ' + p.text.slice(0, 40))
console.log('\n写到：' + outFile)
console.log('下一步：让代理把每条写成她自己的话，再 memory_add（sea=' + sea + '）。')
