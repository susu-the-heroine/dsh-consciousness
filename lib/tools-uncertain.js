/**
 * 确认 / 起疑 两个工具
 * ====================
 *
 * 为什么需要它们：记忆里的「不确定」不能只靠自动推断。
 * 只有人能拍板——「对，就是这样」和「这条我怀疑是错的」。
 *
 * 所以给她两个动作：确认一条、怀疑一条。改的是置信度，不改内容。
 * **一条铁律：这两个工具永远不删记忆。** 怀疑只是把它挪到后面，不是抹掉。
 */
import { readSea, writeSea } from './store.js'
import { acquireWriteLock } from './lock.js'
import { audit } from './log.js'
import { confidenceOf, timeConfidenceOf, confirm, doubt } from './uncertainty.js'

function render(v) {
  return (v && v.log) || ''
}
// 宿主会对 content 调 .some()，所以这里必须给数组，不能给单个对象。
const text = (t) => [{ type: 'text', text: String(t || '') }]

function findPoint(data, id) {
  return (data.points || []).find((p) => Number(p.id) === Number(id))
}

export const confirmTool = {
  name: 'memory_confirm',
  description:
    '确认一条记忆是对的。置信度拉到 0.95，记下核对时间。'
    + '用在：他刚说过「对/没错/就是这样」，或者这条从原话里核过。'
    + '不删不改内容，只提高可信度。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '哪一条（编号）' },
      sea: { type: 'string', description: '哪个识海，不填就是 main' },
    },
    required: ['id'],
  },
  output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } }, render: (_a, v) => text(render(v)) },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const id = Number(args && args.id)
    if (!Number.isFinite(id)) return { ok: false, log: '要确认哪一条？给我编号。' }
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const p = findPoint(data, id)
    if (!p) return { ok: false, log: '没有 #' + id }

    const _lock = acquireWriteLock(sea, 3)
    if (!_lock) return { ok: false, log: '这个识海正在被别的窗口写，等几秒再试。' }
    try {
      const before = confidenceOf(p)
      confirm(p, Date.now())
      const ok = writeSea(sea, data)
      if (!ok) return { ok: false, log: '写盘失败，没确认成。' }
      try { audit('memory-confirm', { sea, id, before, after: p.confidence }) } catch {}
      return {
        ok: true,
        log: '# ' + p.id + ' ' + p.title + '\n'
          + '  置信度 ' + Number(before).toFixed(2) + ' → ' + Number(p.confidence).toFixed(2) + '\n'
          + '  内容已经很可信了；如果日期还是估的，别当事实用。',
      }
    } finally {
      try { _lock.release() } catch {}
    }
  },
}

export const doubtTool = {
  name: 'memory_doubt',
  description:
    '怀疑一条记忆。置信度打到 0.25，检索时会往后排（但不会删）。'
    + '用在：这条明显和事实不符、或者记得含含糊糊。'
    + '只降可信度，不删内容——记忆可以错，但不能消失。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '哪一条（编号）' },
      why: { type: 'string', description: '为什么怀疑（一句话，方便以后回看）' },
      sea: { type: 'string', description: '哪个识海，不填就是 main' },
    },
    required: ['id'],
  },
  output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } }, render: (_a, v) => text(render(v)) },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const id = Number(args && args.id)
    if (!Number.isFinite(id)) return { ok: false, log: '要怀疑哪一条？给我编号。' }
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const p = findPoint(data, id)
    if (!p) return { ok: false, log: '没有 #' + id }

    const _lock = acquireWriteLock(sea, 3)
    if (!_lock) return { ok: false, log: '这个识海正在被别的窗口写，等几秒再试。' }
    try {
      const before = confidenceOf(p)
      doubt(p, Date.now())
      const why = String((args && args.why) || '').trim()
      if (why) p.doubtWhy = why.slice(0, 120)
      const ok = writeSea(sea, data)
      if (!ok) return { ok: false, log: '写盘失败，没标成。' }
      try { audit('memory-doubt', { sea, id, before, why: why.slice(0, 40) }) } catch {}
      return {
        ok: true,
        log: '# ' + p.id + ' ' + p.title + '\n'
          + '  置信度 ' + Number(before).toFixed(2) + ' → 0.25（往后排，但不删）',
      }
    } finally {
      try { _lock.release() } catch {}
    }
  },
}
