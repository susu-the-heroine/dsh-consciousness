/**
 * memory_think —— 让她在被叫到的时候想一句
 * =====================================
 *
 * 为什么不做后台调模型：
 *   插件里没有模型接口；用 DSH 自己的登录凭证去发请求等于扒宿主。
 *   所以做成本来的样子——**她被叫到的那一刻，就在想。**
 *
 * 用法（两步，都在同一轮里）：
 *   1) memory_think {}            → 返回"现在该想什么"：线索、心境、写作规矩
 *   2) memory_think { text: "…" } → 落库、记账、可能触发熔断
 *
 * 闸门跟第三层共用：只有 max 档、每日三条、token 预算、连败三次熔断。
 */
import { planThink, finishThink, thinkStatus } from './think.js'
import { readMode } from './selfmode.js'
import { audit } from './log.js'

// 必须返回**数组**：宿主会对 content 调 .some()，给对象就报 content.some is not a function
const text = (t) => [{ type: 'text', text: String(t || '') }]

export const thinkTool = {
  name: 'memory_think',
  description:
    '让她自己想一句（写进她自己的念头池）。'
    + '不传 text 时返回"现在该想什么"和写作规矩；传了 text 就把这句存下来。'
    + '只在 max 档可用，一天最多三条。'
    + '这句话不外显，只进内观页；将来被想起时才可能被你看见。',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '写好的那一句（不传就是先看该想什么）',
      },
      tokens: {
        type: 'number',
        description: '这一句大概花了多少 token（估的也行，给闸门用）',
      },
    },
    required: [],
  },
  output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } }, render: (_a, v) => text(v && v.log) },
  async execute(args) {
    const t = Date.now()
    const say = String((args && args.text) || '').trim()

    if (!say) {
      // 第一步：告诉她该想什么
      const p = planThink(t)
      if (!p.ok) {
        return { ok: false, log: '这会儿不想（' + p.reason + '）。' + thinkStatus(t) }
      }
      const lines = ['现在可以想一句。', '', p.prompt, '']
      if (p.seed) {
        lines.push('（线索来自记忆 #' + p.seed.id + '：' + String(p.seed.text || p.seed.title || '').slice(0, 50) + '）')
      }
      lines.push('（写好了，把那一句填进 text 再调一次。不写也行——不想就是不想。）')
      try { audit('memory-think-plan', { seed: p.seed ? p.seed.id : 0 }) } catch {}
      return { ok: true, log: lines.join('\n') }
    }

    // 第二步：落库
    const r = finishThink(say, args && args.tokens, t)
    if (!r.ok) return { ok: false, log: '没记上：' + r.reason }
    const mode = readMode()
    try { audit('memory-think-done', { id: r.thought && r.thought.id, flat: !!(r.thought && r.thought.flat) }) } catch {}
    return {
      ok: true,
      log: '记下了：' + String(r.thought.text) + '\n'
        + '（今天第 ' + mode.thoughtsToday + ' 条' + (r.thought.flat ? '·这句偏泛，内观页会标出来' : '') + '）',
    }
  },
}
