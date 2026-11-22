/**
 * 本地日期
 * ======
 * 2026-11-20：原来几处按 ISO（UTC）算「今天」，中国时间早上八点才换日——
 * 凌晨写的那点东西会算到前一天头上，一天被劈成两半。
 * 统一成这里一个函数，谁要「今天」都来拿。
 */
export function localDay(ts = Date.now()) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** 只要「月-日」，给记忆列表显示用 */
export function localMmDd(ts) {
  // 2026-11-20：这个函数没有默认值，时间戳为空或坏掉时 new Date 会给出 Invalid Date，
  // 列表上就显示「NaN-NaN」。时间不知道就返回空串，让调用方自己决定显示什么。
  const _t = Number(ts)
  if (!Number.isFinite(_t) || _t <= 0) return ''
  const d = new Date(_t)
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
