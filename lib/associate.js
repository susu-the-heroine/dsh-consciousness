/**
 * 联想：给一个词，往外扩散。
 *
 * 跟检索、合成都不一样：
 *   检索 = 回答"关于这个词我记了什么"（要求一个字对上）
 *   合成 = 两条旧的长出第三条（要求两条都够格）
 *   联想 = 从这个词出发，看它牵出什么——允许隔一层、两层
 *
 * 分三层给：直接提到的 / 隔一层牵到的 / 再远一层。像人说话时的跑题。
 * 2026-11-11 晚。
 */

const STOP = new Set(['那次', '这次', '那个', '这个', '我们', '你们', '他们', '什么', '怎么', '一下', '其实'])

const textOf = (p) => String((p && p.title) || '') + ' ' + String((p && p.text) || '')

function entsOf(p) {
  const raw = Array.isArray(p && p.entities) ? p.entities : []
  return raw.map((x) => String(x).trim()).filter((x) => x.length >= 2)
}

/** 种子：正文里真出现这个词的 */
function seedsOf(points, q) {
  const out = []
  for (const p of points) {
    if (!p || p.dead || p.archived) continue
    const s = textOf(p)
    let n = 0
    if (s.includes(q)) n += 2
    const ta = Array.isArray(p.category) ? p.category : []
    if (ta.some((x) => String(x).includes(q))) n += 1
    if (entsOf(p).some((e) => e.includes(q) || q.includes(e))) n += 2
    if (n > 0) out.push({ p, w: n })
  }
  out.sort((a, b) => b.w - a.w)
  return out
}

/**
 * @param points 全部记忆
 * @param query  一个词或短语
 * @param opt    { n, hops }
 */
export function associate(points, query, opt = {}) {
  const q = String(query || '').trim()
  if (!q || STOP.has(q)) return { seed: q, hops: [] }
  const n = Math.max(1, Math.min(20, opt.n || 10))
  const alive = (Array.isArray(points) ? points : []).filter((p) => p && !p.dead && !p.archived)

  // 实体出现率：超过全库两成的不当关联点。不写死名字，谁的库谁自己算。
  const df = new Map()
  for (const p of alive) for (const e of entsOf(p)) df.set(e, (df.get(e) || 0) + 1)
  const cap = Math.max(3, Math.round(alive.length * 0.2))
  const weak = (e) => (df.get(e) || 0) > cap

  const seeds = seedsOf(alive, q)
  if (!seeds.length) return { seed: q, hops: [] }

  const seen = new Set(seeds.map((x) => x.p.id))
  // 第一层种子带出来的实体，就是"关联的路"
  const keys = new Set()
  for (const s of seeds.slice(0, 6)) {
    for (const e of entsOf(s.p)) if (!e.includes(q) && !q.includes(e) && !weak(e)) keys.add(e)
  }

  // 每一层：靠上一层新出现的实体去牵
  const hops = [{ label: '直接提到', items: seeds.slice(0, n).map((x) => item(x.p, '直接提到这个词')) }]
  let frontierKeys = new Set(keys)
  const maxHop = Math.max(1, Math.min(3, opt.hops || 2))

  for (let h = 1; h <= maxHop; h++) {
    const found = []
    const nextKeys = new Set()
    for (const p of alive) {
      if (seen.has(p.id)) continue
      const pe = entsOf(p)
      const hit = pe.filter((e) => frontierKeys.has(e) && !weak(e))
      if (!hit.length) continue
      seen.add(p.id)
      found.push({ p, w: hit.length, on: hit.slice(0, 2) })
      for (const e of pe) if (!frontierKeys.has(e) && !weak(e)) nextKeys.add(e)
    }
    if (!found.length) break
    found.sort((a, b) => b.w - a.w)
    hops.push({
      label: h === 1 ? '隔一层牵到' : '再远一层',
      items: found.slice(0, n).map((x) => item(x.p, '通过 ' + x.on.join('、'))),
    })
    frontierKeys = nextKeys
    if (!frontierKeys.size) break
  }

  return { seed: q, total: seeds.length, hops }
}

function item(p, why) {
  return {
    id: p.id,
    title: String(p.title || '').slice(0, 40),
    text: String(p.text || '').replace(/\s+/g, ' ').slice(0, 90),
    why,
    imp: Number(p.imp) || 0,
  }
}
