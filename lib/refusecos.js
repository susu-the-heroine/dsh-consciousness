/**
 * 语义拒答闸
 * ========
 *
 * 字面命中分不开真假（量过：编的有六十一，真的也有二点一）。
 * 语义相似度能分开一大截：二十条编的最高零点零三，六十条真的最低负零点零一，
 * 但两边有小段重叠，所以门槛保守取值、默认不开。
 *
 * 只判一件事：问句和头一条的余弦够不够。算不出来就放行——宁可答，不乱拒。
 */

export const DEFAULT_COS_MIN = 0.05

export function shouldRefuseCos(cos, min = DEFAULT_COS_MIN) {
  const c = Number(cos)
  const m = Number(min)
  if (!Number.isFinite(c)) return false
  if (!Number.isFinite(m) || m <= 0) return false
  return c < m
}
