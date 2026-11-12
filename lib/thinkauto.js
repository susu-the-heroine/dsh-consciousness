/**
 * 自己会想：不等谁点按钮。
 *
 * 每过一阵，它自己挑一条线索，跑一遍十种动作，把"该想什么"记下来。
 * 面板上的「联想」只是看结果的窗户，不是开关。
 *
 * 挑线索的规矩（学着人的偏向，但不装人）：
 *   - 久没被提起的、情绪重的、最近刚写下的，优先
 *   - 同一条两天内不重复挑
 *
 * 记在 ~/.dsh/consciousness-thoughts.json，最多留 60 条，老的挤掉。
 * 2026-11-11 深夜。苏苏侠问："为什么想需要我点呢？"
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { think } from './thinkops.js'

const FILE = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-thoughts.json')
const MAX = 60

export function readThoughts() {
  try {
    if (!existsSync(FILE)) return []
    const j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    return Array.isArray(j.items) ? j.items : []
  } catch { return [] }
}

function saveThoughts(items) {
  try { writeFileSync(FILE, JSON.stringify({ at: Date.now(), items: items.slice(0, MAX) }, null, 1), 'utf8') } catch {}
}

/** 挑一条线索：久没想、情绪重、近的优先，两天内不重复 */
export function pickSeed(points, now = Date.now()) {
  const alive = (Array.isArray(points) ? points : []).filter((p) => p && !p.dead && !p.archived)
  if (!alive.length) return null
  const recent = new Set(readThoughts().filter((x) => now - (x.at || 0) < 2 * 86400000).map((x) => String(x.seedId)))
  const cand = alive.filter((p) => !recent.has(String(p.id)))
  const pool = cand.length ? cand : alive
  const score = (p) => {
    const days = p.lastSeen ? (now - Number(p.lastSeen)) / 86400000 : 30
    const ar = (Number(p.arousal) || 0) / 10
    const imp = Number(p.imp) || 0
    return Math.min(days, 60) * 0.02 + ar * 1.2 + imp * 0.8
  }
  pool.sort((a, b) => score(b) - score(a))
  return pool[0]
}

/**
 * 想一次。返回这一次想了什么（也写进盘）。
 * @param points 全部记忆
 * @param opt { seedId?, now?, max? }
 */
export async function autoThinkOnce(points, opt = {}) {
  const now = opt.now || Date.now()
  const alive = (Array.isArray(points) ? points : []).filter((p) => p && !p.dead && !p.archived)
  const seed = opt.seedId != null
    ? alive.find((p) => String(p.id) === String(opt.seedId))
    : pickSeed(alive, now)
  if (!seed) return { ok: false, reason: '库里没东西可想' }

  const r = think(alive, { id: seed.id }, { max: opt.max || 5 })
  if (!r.ops.length) return { ok: false, reason: '这条想不出动作', seedId: seed.id }

  // 顺手把"这句该写成什么"的题面也备好：走已有的那一层，不重复造。
  let prompt = ''
  try {
    const th = await import('./think.js')
    const plan = th.planThink(now, { text: String(seed.text || seed.title || '').slice(0, 60) })
    if (plan && plan.ok) prompt = plan.prompt
  } catch {}

  const record = {
    at: now,
    prompt,
    seedId: seed.id,
    seedTitle: String(seed.title || '').slice(0, 40),
    opened: r.opened,
    closed: r.closed,
    ops: r.ops.map((o) => ({
      op: o.op,
      label: o.label,
      hint: o.hint,
      items: o.items.map((x) => ({ id: x.id, title: x.title, why: x.why })),
    })),
  }
  const all = readThoughts()
  all.unshift(record)
  saveThoughts(all)
  try { markThought(now) } catch {}
  return { ok: true, thought: record }
}

/* ───── 什么时候该想 ─────
 * 不是按整点。人不是钟表驱动的。
 * 四种撞上才想：
 *   一、刚有人来过（识海文件刚被写过，说明在说话）
 *   二、空下来了（有一阵没人来）
 *   三、有件事悬着（库里有没闭环的）
 *   四、情绪顶着头（心脏能量高）
 * 再压两条闸：一天最多 8 次、同一条两天不重复。
 * 2026-11-11 深夜，苏苏侠问"什么时候会想什么时候该想"。
 */
import { statSync } from 'node:fs'

const META_FILE = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-thinkgate.json')

function readGate() {
  try {
    if (!existsSync(META_FILE)) return { day: '', count: 0, last: 0 }
    const j = JSON.parse(readFileSync(META_FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
    const today = new Date().toISOString().slice(0, 10)
    if (j.day !== today) return { day: today, count: 0, last: Number(j.last) || 0 }
    return { day: today, count: Number(j.count) || 0, last: Number(j.last) || 0 }
  } catch { return { day: new Date().toISOString().slice(0, 10), count: 0, last: 0 } }
}

function saveGate(g) {
  try { writeFileSync(META_FILE, JSON.stringify(g), 'utf8') } catch {}
}

/** 该不该现在想。返回 { ok, why }
 *
 * 三次改法，记下来免得又绕回去：
 *   一版：每两小时一次（按钟表，不像人）
 *   二版：没人说话就不想（反了，人最闲的时候脑子最吵）
 *   三版（现在）：不数次数，数"有没有新东西"。
 *     有新材料、或还有件悬着的事，就想；两样都没有，就是想到腻了，不想。
 *     再留一个兜底上限（一天 20 次），防跑飞——这不是心理学，是怕烧钱。
 */
export function shouldThinkNow(points, heart, now = Date.now()) {
  const g = readGate()
  if (g.count >= 20) return { ok: false, why: '兜底上限（20 次），防跑飞' }

  // 识海文件什么时候被写过：既是"有人来过"，也是"有没有新料"
  let quietMin = 999
  let changedAt = 0
  try {
    const f = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-seas', 'main', 'data.json')
    if (existsSync(f)) {
      const st = statSync(f)
      quietMin = (now - st.mtimeMs) / 60000
      changedAt = st.mtimeMs
    }
  } catch {}

  const gapMin = (now - g.last) / 60000
  const fresh = changedAt > (g.last || 0)        // 上次想过之后，库里添了新东西

  // 有件悬着的事
  let pending = false
  try {
    const alive = (Array.isArray(points) ? points : []).filter((p) => p && !p.dead && !p.archived)
    pending = alive.some((p) => /缺|还没|待|下一步|差/.test(String(p.text || '')))
  } catch {}

  // 刚说过话：别插嘴，隔久一点
  if (quietMin < 40) {
    if (gapMin < 90) return { ok: false, why: '刚说过话，别插嘴' }
    if (!fresh && !pending) return { ok: false, why: '没有新料，也没什么悬着' }
    return { ok: true, why: fresh ? '库里有新东西' : '有件事还悬着', mode: 'chat' }
  }

  // 安静着：想事的主要时候
  if (gapMin < 40) return { ok: false, why: '刚想过' }
  if (fresh) return { ok: true, why: '安静着，库里又有新料', mode: 'idle' }
  if (pending) return { ok: true, why: '安静着，有件事还悬着', mode: 'idle' }
  return { ok: false, why: '安静了很久，但库里没添新事——想到头了' }
}

/** 记一次：想过了 */
export function markThought(now = Date.now()) {
  const g = readGate()
  g.count += 1
  g.last = now
  saveGate(g)
}
