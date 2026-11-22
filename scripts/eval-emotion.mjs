/**
 * 情绪 + 时间 那条路：不靠词，按"最近 + 情绪极性"捞人
 * ====================================================
 *
 * 场景：用户说"我那天不开心"，不说日期、不说事。
 * 词匹配抓不到（"不开心"不在记忆里），所以走另一条：
 *   1. 从问句里认出时间范围（今天/昨天/前几天/那天）
 *   2. 从问句里认出情绪极性（负面/正面）
 *   3. 按时间倒序取该范围内的记忆，只留极性对得上的
 *   4. 最多递三条给他认领
 *
 * 跑法：node scripts/eval-emotion.mjs "那天我不开心"
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const q = process.argv[2] || '那天我不开心'

const NEG = /不开心|难受|难过|崩|烦|糟|气死|委屈|疼|哭|失败|考砸|没考好/
const POS = /开心|高兴|爽|舒服|顺|成了|赢|夸/
const DAY = 86400000

function whenOf(t) {
  const now = Date.now()
  if (/昨天/.test(t)) return { from: now - 2 * DAY, to: now - 1 * DAY, label: '昨天' }
  if (/前天/.test(t)) return { from: now - 3 * DAY, to: now - 2 * DAY, label: '前天' }
  if (/这几天|这阵子|最近/.test(t)) return { from: now - 7 * DAY, to: now, label: '最近几天' }
  if (/上次|那天|那天儿|有一回/.test(t)) return { from: now - 14 * DAY, to: now, label: '最近两周' }
  return { from: 0, to: Date.now(), label: '全部' }
}

// 2026-11-21：这里原来先看 lastSeen。可 lastSeen 是「上次被想起的时间」——
// 每想起一次就刷新，整库几乎都是今天。于是「那天不开心」这类按日子捞人的问法，
// 捞出来全是「今天」，范围过滤等于没做。改成优先用 born（这件事发生的日子）。
function tsOf(p) {
  const v = p.born || p.date || p.time || p.addedAt || p.lastSeen || 0
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? Date.parse(m[1] + '-' + m[2] + '-' + m[3]) : 0
}

const dir = join(homedir(), '.dsh', 'consciousness-seas', 'main')
const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const pts = (data.points || []).filter((p) => !p.dead)

const want = NEG.test(q) ? -1 : POS.test(q) ? 1 : 0
const when = whenOf(q)
console.log(`问句：「${q}」`)
console.log(`认出：时间=${when.label}  情绪=${want === -1 ? '负面' : want === 1 ? '正面' : '没情绪'}`)
console.log('')

const pool = pts.filter((p) => {
  const t = tsOf(p)
  if (!t) return false
  if (t < when.from || t > when.to) return false
  if (!want) return true
  const pol = Number(p.polarity)
  if (!Number.isFinite(pol)) return true          // 没标极性的先留着，靠后面的词兜
  return want === -1 ? pol < 0 : pol > 0
})

pool.sort((a, b) => tsOf(b) - tsOf(a))
console.log(`范围内 ${pool.length} 条，按时间倒序取前 5：`)
for (const p of pool.slice(0, 5)) {
  const d = new Date(tsOf(p))
  const day = `${d.getMonth() + 1}月${d.getDate()}日`
  console.log(`  ${day} · 极性 ${p.polarity ?? '未标'} · ${String(p.title || '').slice(0, 26)}`)
}

const withPol = pool.filter((p) => Number.isFinite(Number(p.polarity)))
console.log('')
console.log(`这堆里有 ${withPol.length}/${pool.length} 条标了情绪极性。`)
if (pool.length && withPol.length === 0) {
  console.log('→ 极性一条没标，这条路现在只能靠时间排序，选不准。')
}
