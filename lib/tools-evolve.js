/**
 * memory_annotate —— 给旧记忆批一句"现在看是另一回事"
 * ==================================================
 *
 * 为什么要有（2026-11-14，读了 A-MEM 之后）：记忆不该只越攒越多，
 * 新事进来会改变旧事的意思。但**不改原文**——只改两处：
 *
 *   一、别名（别人会怎么问它）：以后换个说法也问得到
 *   二、一条批注：带日期，一句人话，像书页边的笔记
 *
 * 正文一个字不碰。旧的批注也不删，一层层往上长。
 * 这样"原来的话"永远在，新的理解在旁边。
 */
import { readSea, writeSea, lockSea, unlockSea } from './store-js.js'

function text(v) {
  return [{ type: 'text', text: String(v == null ? '' : v) }]
}

export const annotateTool = {
  name: 'memory_annotate',
  description:
    '给一条旧记忆补两样东西：一句批注（现在看这件事更清楚了什么），以及可选的别名更新。'
    + '不改正文。用在：新发生的事让旧的那条意思变了——别新写一条，来这儿批一句。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '要批注的记忆编号' },
      note: {
        type: 'string',
        description: '一句人话，不超过 60 字。第一人称，别写成总结或报告。',
      },
      alias: {
        type: 'string',
        description: '可选。原来那句问法盖不住了，换成什么问法（别人口语里会怎么问）',
      },
      sea: { type: 'string', description: '哪个识海，默认 main' },
    },
    required: ['id', 'note'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' }, log: { type: 'string' } },
    },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const id = Number(args && args.id)
    const note = String((args && args.note) || '').trim()
    const alias = String((args && args.alias) || '').trim()
    const sea = String((args && args.sea) || 'main')
    if (!Number.isFinite(id) || id <= 0) return { ok: false, log: '得给我记忆编号。' }
    if (!note) return { ok: false, log: '批注不能是空的。' }
    if (note.length > 120) return { ok: false, log: '批注太长了，压到 120 字以内。' }

    const lock = lockSea(sea)
    if (!lock.ok) return { ok: false, log: '拿不到锁：' + String(lock.err || '') }
    try {
      const data = readSea(sea)
      if (!data || !Array.isArray(data.points)) return { ok: false, log: '没有这个海。' }
      const p = data.points.find((x) => Number(x.id) === id)
      if (!p) return { ok: false, log: '这个编号不存在。' }
      if (p.dead) return { ok: false, log: '这条已经沉底了，批注没意义。' }

      const now = Date.now()
      if (!Array.isArray(p.notes)) p.notes = []
      // 同一天同一条只留一条批注，别叠
      const today = new Date(now).toDateString()
      const dup = p.notes.find((x) => x && new Date(Number(x.t) || 0).toDateString() === today)
      if (dup) {
        dup.text = note
        dup.t = now
      } else {
        p.notes.push({ t: now, text: note })
        if (p.notes.length > 12) p.notes = p.notes.slice(-12)
      }

      if (alias && alias.length <= 60) p.alias = alias
      p.evolvedAt = now

      // 2026-11-20：写海的回执原来不看——写不进去也照样回「旁边加了一句」。
      // 这正是这个插件反复栽的那类：失败当成功，用户以为记上了，其实没落盘。
      const w = writeSea(sea, data, lock)
      if (!w || w.ok === false) {
        try { unlockSea(lock) } catch {}
        return { ok: false, log: '写不进去：' + String((w && w.err) || '写盘被拒') }
      }
      const d = new Date(now)
      const day = `${d.getMonth() + 1}月${d.getDate()}日`
      return {
        ok: true,
        log:
          `#${id} 旁边加了一句（${day}）：${note}\n`
          + (alias ? `别名也改成：${alias}\n` : '')
          + '正文没动，原来的话还在。',
      }
    } catch (e) {
      try { unlockSea(lock) } catch {}
      return { ok: false, log: '写不进去：' + String((e && e.message) || e).slice(0, 80) }
    }
  },
}

export default annotateTool
