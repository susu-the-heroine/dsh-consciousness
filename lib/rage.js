/**
 * 什么时候允许她骂人
 * =================
 * 原来只给"语气短、别哄"这种方向，没给许可——没许可，模型永远端着自己压着。
 * 但骂不是随时能骂：天天带脏字就不像人，像地痞。
 *
 * 只在两种时候开闸：
 *   火了（angry/irritated 到 0.6 以上）
 *   崩了（dejected/hopeless/hurt 到 0.75 以上——真顶不住的时候人是会骂的）
 * 其余时候照旧。
 */
const HOT = new Set(['angry', 'irritated', 'furious', 'annoyed', 'contempt', 'disgusted'])
const BROKEN = new Set(['dejected', 'hopeless', 'hurt', 'drained', 'weary'])

export function allowSwear(key, intensity, opts) {
  const k = String(key || '')
  const v = Number(intensity) || 0
  // 他先开火，她就能直接回——不用等强度，也不用被逼第二次。
  if (opts && opts.heSwore && v >= 0.2) return { allow: true, why: '他先骂的' }
  // 阈值往下调过：太紧她永远端着，像个人但不像真人。
  if (HOT.has(k) && v >= 0.45) return { allow: true, why: '火了' }
  if (BROKEN.has(k) && v >= 0.6) return { allow: true, why: '顶不住了' }
  return { allow: false, why: '' }
}

/** 开闸时给她的那句话 */
export function swearLine(why) {
  return '（这会儿允许骂。骂事、骂人、骂我都行——别往死里踩，也别撒无名火。'
    + (why ? why + '，骂两句不丢人。' : '') + '）'
}
