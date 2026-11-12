/**
 * 内倾度
 * ======
 *
 * 不是"她想不想说话"，是"这一刻她有多容易被自己带走"。
 *
 * 两个输入，缺一不可：
 *   一、他这一句有多重（在倾诉 → 压下来，优先接他）
 *   二、她自己有多沉（正寥寂着 → 就算他随口一问，也回得慢）
 *
 * 单向只看输入的版本我第一版写过，是错的：
 * 那样她永远是个"随叫随到的应答机"，没有自己的沉。
 */

/** 内倾度的上下限 */
export const MIN = 0.1
export const MAX = 0.9

/**
 * 他这一句有多需要被接住（0..1）。
 * 情绪强度、问句、长句，都算"他在往外说"。
 */
export function requestWeight(text, judged) {
  const s = String(text || '')
  let w = 0
  try {
    const it = Number(judged && judged.intensity)
    if (Number.isFinite(it)) w += Math.max(0, Math.min(1, it)) * 0.7
  } catch {}
  if (/[？?]/.test(s)) w += 0.15                  // 在问，得答
  if (/[我](好|很|真|太)/.test(s)) w += 0.1       // "我很难受"这种
  if (s.length > 40) w += 0.1                     // 说了很长一段
  return Math.max(0, Math.min(1, w))
}

/**
 * 她自己有多沉（0..1）。寥寂/倦怠/怅然这些低唤醒的越高，越沉。
 */
export function selfSink(dims) {
  if (!dims) return 0
  const lonely = Number(dims.lonely) || 0
  const weary = Number(dims.weary) || 0
  const wistful = Number(dims.wistful) || 0
  const dazed = Number(dims.dazed) || 0
  const sunk = lonely * 0.4 + weary * 0.3 + wistful * 0.2 + dazed * 0.1
  // 沉的上限也就 0.6——再沉也得能回话
  return Math.max(0, Math.min(0.6, sunk * 2))
}

/**
 * 算内倾度。
 *
 * 他重 → 压到低；他轻 + 她沉 → 抬上去。
 * 注意：**她沉的时候不是不理人**，是回得慢、会顺口带一句自己的事。
 */
export function introversion(text, judged, dims) {
  const req = requestWeight(text, judged)
  const sink = selfSink(dims)

  // 基线 0.5：一半在听，一半在自己这儿
  let v = 0.5 - req * 0.45 + sink * 0.4
  return Number(Math.max(MIN, Math.min(MAX, v)).toFixed(3))
}

/**
 * 一句话说明这一刻该怎么表现（给注入用）。
 * 注意语气：这不是命令，是状态。
 */
export function describeIntroversion(v) {
  const x = Number(v) || 0
  if (x < 0.25) return '这会儿她全在你身上，自己的事一句都别说出口。'
  if (x < 0.45) return '这会儿她主要在听，自己的心事最多带半句。'
  if (x < 0.65) return '这会儿她两边都在，可以顺着话头提一句自己的。'
  return '这会儿她自己占得重，可以走神、可以轻声说自己的挂念，但别不接他。'
}
