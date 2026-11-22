/**
 * 从真实问法日志里重建"待标注题库"
 * ================================
 *
 *   node scripts/build-query-bank.mjs [识海]
 *
 * 输出 `scripts/data/query-bank.jsonl`，一行一条：
 *   {"q":"他问的原话","top":<当时排第一的编号>,"core":[...],"at":<时间>}
 *
 * 这不是标注集。标注得人来定——哪条记忆才算"该中的那一条"。
 * 2026-11-15 凌晨我误删了旧的标注集；宁可重来，也不照着记忆把编号填回去，
 * 编号错一个，之后的分数就全是假的。
 *
 * 标注流程：拿这个文件，把 top 改成"应该中的编号"，另存为 labeled-batch.json。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = (process.argv[2] || 'main').trim() || 'main'
const logPath = process.env.DSH_PICK_LOG || join(homedir(), '.dsh', 'consciousness-pick-log.jsonl')
const outPath = join(HERE, 'data', 'query-bank.jsonl')

if (!existsSync(logPath)) {
  console.log('没有问法日志：' + logPath)
  process.exit(1)
}

const rows = []
for (const line of readFileSync(logPath, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let r
  try { r = JSON.parse(line) } catch { continue }
  if (!r || !r.q) continue
  if (r.sea && r.sea !== sea) continue
  const q = String(r.q).trim()
  if (!q) continue
  // 日志里混着调度器消息、后台任务回执、子智能体的长段落——那些不是"他在问"。
  // 只留像人话的：短、单行、不带这些机器前缀。
  if (q.length > 40) continue
  if (/[\n\r]/.test(q)) continue
  if (/^(Agent session|background job|###|\[schedule)/i.test(q)) continue
  if (/\d{4}-\d{2}-\d{2}T\d{2}:/.test(q)) continue
  rows.push({
    q,
    top: Array.isArray(r.core) && r.core.length ? Number(r.core[0]) : null,
    core: Array.isArray(r.core) ? r.core.map(Number) : [],
    at: Number(r.at) || 0,
  })
}

// 同一个问题反复问只留最后一条（排序会变，留最新的更接近当前算法）
const byQ = new Map()
for (const r of rows) byQ.set(r.q, r)
const uniq = [...byQ.values()].sort((a, b) => b.at - a.at)

const out = uniq.map((r) => JSON.stringify(r)).join('\n') + '\n'
writeFileSync(outPath, out, 'utf8')
console.log(`海 ${sea}：日志 ${rows.length} 行 → 去重后 ${uniq.length} 条 → ${outPath}`)
console.log('下一步：把每条的 top 改成"应该中的编号"，另存为 labeled-batch.json。别猜编号。')
