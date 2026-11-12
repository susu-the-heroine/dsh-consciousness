/**
 * 性格 = 基线偏移
 * ==============
 *
 * 这是第三层模拟的核心判断：**性格不该是语气，应该是状态**。
 *
 * 上一轮测出来的毛病：把"悲观多虑"写进提示词，模型就把它演成口癖——
 * 十句话里四句是"我怕我说了你会烦"。那不叫悲观，那叫背台词。
 *
 * 真正的区别应该是：
 *   · 同一句"我累死了"，温和的人往恻隐走，傲娇的人往不甘走，悲观的人往怅然走
 *   · 而且**同一个人重复听同一句话，第二次的动静要更小**（惯性/习惯化）
 *
 * 所以性格在这里不写句子，只给**八维的偏移**：她的底子往哪儿偏一点。
 * 语气由数值决定，不由提示词决定。
 */
import { DIM_KEYS } from './emotion-lexicon.js'

/** 偏移量：正数=这一类更容易上来 */
export const PERSONAS = {
  gentle: { name: '温和共情', bias: { tender: 0.12, calm: 0.06 }, damp: 0.3 },
  introvert: { name: '内向孤僻', bias: { lonely: 0.12, dazed: 0.05 }, damp: 0.45 },
  stubborn: { name: '执拗较真', bias: { unreconciled: 0.13, calm: -0.05 }, damp: 0.25 },
  sunny: { name: '乐天随性', bias: { calm: 0.12, flutter: 0.06, weary: -0.05 }, damp: 0.2 },
  gloomy: { name: '悲观多虑', bias: { wistful: 0.12, weary: 0.08 }, damp: 0.35 },
  tsundere: { name: '傲娇嘴硬', bias: { unreconciled: 0.10, tender: 0.08 }, damp: 0.4 },
  slacker: { name: '慵懒摆烂', bias: { weary: 0.13, dazed: 0.06 }, damp: 0.6 },
  fiery: { name: '热烈直率', bias: { flutter: 0.14, unreconciled: 0.05 }, damp: 0.05 },
  nostalgic: { name: '怀旧念旧', bias: { wistful: 0.14, tender: 0.07 }, damp: 0.5 },
  timid: { name: '胆怯害羞', bias: { flutter: 0.10, lonely: 0.08 }, damp: 0.3 },
  // 冷静疏离的核心不是"更安宁"，是**反应更小**——
  // 上一轮实测：给它加 calm 0.14，安宁连前三都没进，被底噪吃掉了。
  // 所以这条改成阻尼：同一下推，它挪得比谁都少。
  detached: { name: '冷静疏离', bias: { calm: 0.05, tender: -0.05 }, damp: 0.75 },
  sensitive: { name: '敏感细腻', bias: { flutter: 0.09, tender: 0.07, unreconciled: 0.05 }, damp: 0.25 },
  hotblood: { name: '冲动热血', bias: { flutter: 0.13, unreconciled: 0.08 }, damp: 0.08 },
  warmslow: { name: '温柔慢热', bias: { tender: 0.11, calm: 0.05, lonely: 0.04 }, damp: 0.55 },
  selfdoubt: { name: '自卑敏感', bias: { weary: 0.09, unreconciled: 0.07, lonely: 0.06 }, damp: 0.3 },
}

export const PERSONA_KEYS = Object.keys(PERSONAS)

/** 没写阻尼的给个默认值（0.3）：人是会被推的，只是程度不同 */
export const DEFAULT_DAMP = 0.3

/** 这个性格的阻尼（0=一点就着，1=推不动） */
export function dampOf(personaKey) {
  const p = PERSONAS[personaKey]
  const d = Number(p && p.damp)
  return Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : DEFAULT_DAMP
}

/**
 * 按性格掺一次：同样一份新状态，阻尼高的只挪一点点。
 * 这里的 impact 仍然保留"能翻盘"的特权（他要走，多冷静的人也会动）。
 */
export function mixWithPersona(oldDims, nextDims, personaKey, impact) {
  const d = impact ? Math.min(0.35, dampOf(personaKey)) : dampOf(personaKey)
  const inertia = 1 - (1 - 0.3) * (1 - d)   // d=0 → 0.3；d=0.75 → 0.125
  const out = {}
  for (const k of DIM_KEYS) {
    const a = Number(oldDims && oldDims[k]) || 0
    const b = Number(nextDims && nextDims[k]) || 0
    out[k] = a * inertia + b * (1 - inertia)
  }
  return norm(out)
}

/** 归一化（八维加起来是 1） */
function norm(d) {
  const out = {}
  let sum = 0
  for (const k of DIM_KEYS) {
    const v = Math.max(0, Number(d && d[k]) || 0)
    out[k] = v
    sum += v
  }
  if (!sum) {
    const eq = Number((1 / DIM_KEYS.length).toFixed(4))
    for (const k of DIM_KEYS) out[k] = eq
    return out
  }
  for (const k of DIM_KEYS) out[k] = Number((out[k] / sum).toFixed(4))
  return out
}

/** 把性格偏到八维上去（加完再归一化，所以不会把量级搞乱） */
export function applyPersona(dims, personaKey, strength) {
  const p = PERSONAS[personaKey]
  if (!p) return norm(dims)
  const s = Number.isFinite(Number(strength)) ? Math.max(0, Math.min(2, Number(strength))) : 1
  const out = {}
  for (const k of DIM_KEYS) out[k] = Number(dims && dims[k]) || 0
  for (const [k, v] of Object.entries(p.bias)) {
    out[k] = Number(out[k]) + Number(v) * s
  }
  return norm(out)
}

/** 一句人话：这个性格的底子偏哪边 */
export function describePersona(personaKey) {
  const p = PERSONAS[personaKey]
  if (!p) return ''
  const top = Object.entries(p.bias).sort((a, b) => b[1] - a[1]).slice(0, 2)
  return p.name + '（底子偏 ' + top.map(([k, v]) => k + (v > 0 ? '+' : '')).join('、') + '）'
}
