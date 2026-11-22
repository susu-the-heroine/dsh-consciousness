/**
 * 从真实问法里捞别名（只出候选，永不写库）
 * ====================================
 *
 *   node scripts/alias-learn2.mjs [识海] [最少次数] [最少天数]
 *
 * 为什么不用现成的 alias-suggest：那个是拿标题套模板（"X是怎么回事"），在编话。
 * 这个只认一件事：**他真的用同一句话问过同一件事，至少三次、跨至少两天。**
 * 那才算"他会怎么说这件事"。
 *
 * 四道闸：
 *   1. 同一问句（规范化后）→ 同一条记忆，≥3 次
 *   2. 这几次跨 ≥2 天
 *   3. 问句长度 ≥4（太短没信息）
 *   4. 问句里至少有一个 2-3 字片段，在本库别的记忆里也出现过（不是他一个人的暗号）
 *
 * 输出：~/.dsh/consciousness-alias-candidates2.md，一行一条，按证据次数排序。
 * 不写 data.json，不碰 alias 字段——要写，得人看过再手动来。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'main').trim() || 'main'
const MIN_HITS = Math.max(2, Number(process.argv[3]) || 3)
const MIN_DAYS = Math.max(1, Number(process.argv[4]) || 2)

const T = await import('file:///' + join(HERE, '..', 'lib', 'text.js').replace(/\\/g, '/'))

const D = join(homedir(), '.dsh')
// 允许用环境变量指向一份临时日志：这样"闸到底拦不拦"可以在沙箱里证明，
// 不用等真实使用攒够样本。
const logPath = process.env.DSH_PICK_LOG || join(D, 'consciousness-pick-log.jsonl')
const dataPath = join(D, 'consciousness-seas', sea, 'data.json')
if (!existsSync(logPath) || !existsSync(dataPath)) {
  console.log('缺日志或缺库')
  process.exit(1)
}

const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead && !p.archived)
const byId = new Map(pts.map((p) => [Number(p.id), p]))

// 库里的短语（用来判断"这话是不是只有他知道"）
const libGrams = new Map()
for (const p of pts) {
  for (const w of T.gramsOf(String(p.title || '') + ' ' + String(p.text || ''))) {
    libGrams.set(w, (libGrams.get(w) || 0) + 1)
  }
}

// 2026-11-21：这里原来把问句砍到十二个字再比。两句话只要前十二个字一样就算同一句——
// 实测「……事儿好吗」和「……事儿好吧呢」被并成一条，两次加一次凑成「三次」，凭空多出一个候选。
// 全是同一句才叫同一句，不砍。
const norm = (q) => String(q || '')
  .replace(/\s+/g, '')
  .replace(/[，。！？、,.!?~～…：:；;"'“”‘’（）()【】\[\]]/g, '')

const rows = []
for (const line of readFileSync(logPath, 'utf8').split('\n')) {
  if (!line.trim()) continue
  try {
    const r = JSON.parse(line)
    if (!r || String(r.sea || 'main') !== sea) continue
    const rawQ = String(r.q || '').trim()
    // 过滤不是"他本人说的话"：定时提醒、子智能体的消息、超长的系统注入。
    if (/^\[SCHEDULE REMINDER/i.test(rawQ)) continue
    if (/^Agent session/i.test(rawQ)) continue
    if (rawQ.length > 200) continue
    if (!Array.isArray(r.rel) || !r.rel.length) continue
    rows.push({ at: Number(r.at) || 0, q: norm(r.q), top: Number(r.rel[0]) || 0 })
  } catch {}
}

const groups = new Map()
for (const r of rows) {
  if (!r.q || r.q.length < 4 || !r.top) continue
  const key = r.q + '→' + r.top
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r.at)
}

const out = []
for (const [key, times] of groups) {
  if (times.length < MIN_HITS) continue
  const days = new Set(times.map((t) => new Date(t).toISOString().slice(0, 10)))
  if (days.size < MIN_DAYS) continue
  const [q, topRaw] = key.split('→')
  const p = byId.get(Number(topRaw))
  if (!p) continue
  // 第四闸：问句里至少有一个片段在别的记忆里也出现过
  const grams = [...T.gramsOf(q)]
  const shared = grams.filter((w) => (libGrams.get(w) || 0) >= 2)
  if (!shared.length) continue
  out.push({ q, id: Number(topRaw), title: String(p.title || ''), hits: times.length, days: days.size, shared: shared.slice(0, 3) })
}

out.sort((a, b) => b.hits - a.hits || b.days - a.days)
const file = join(D, 'consciousness-alias-candidates2.md')
const lines = ['# 别名候选（从真实问法里捞的）', '', `识海 ${sea} · 闸：≥${MIN_HITS} 次、跨 ≥${MIN_DAYS} 天、问句片段在别处也出现过`, '']
for (const o of out) {
  lines.push(`- 记忆 #${o.id}「${o.title.slice(0, 24)}」 ← 他这样问过 ${o.hits} 次 / ${o.days} 天：\`${o.q}\`（共用片段：${o.shared.join('、')}）`)
}
lines.push('', out.length ? '看完再决定写不写。这个脚本不会动库。' : '没有候选。要么他还没重复问过同一件事，要么闸太严。')
writeFileSync(file, lines.join('\n'), 'utf8')

console.log(`识海 ${sea} · 日志 ${rows.length} 条 · 候选 ${out.length} 条`)
console.log('审阅稿：' + file)
for (const o of out.slice(0, 10)) {
  console.log(`  #${o.id} ${o.title.slice(0, 18)} ← ${o.q}（${o.hits} 次 / ${o.days} 天）`)
}
