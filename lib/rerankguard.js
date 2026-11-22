/**
 * 重排护栏
 * ========
 *
 * 重排是最后一个裁判。它会因为「读起来更像」把字面证据压下去。
 * 见过的实况：一个字面命中六十七分的条目，被一条十七分的顶掉。
 *
 * 规则只有一条：重排前后比命中数，赢太多就不许压。
 * 门槛写死成 2.5 倍且不少于 40 次命中——不是按某个人的库调的，
 * 是按「字面证据够不够硬」定的，换谁的库都该这么算。
 */

export const GUARD_MIN_HIT = 40
export const GUARD_RATIO = 2.5

/**
 * @param preTop 重排前的第一名 { id, hit, ref }
 * @param scored 重排后的数组
 * @returns 处理过的数组（没触发就原样返回同一份）
 */
export function applyRerankGuard(preTop, scored) {
  const list = Array.isArray(scored) ? scored : []
  if (!preTop || !list.length) return list
  const hit = Number(preTop.hit) || 0
  if (hit < GUARD_MIN_HIT) return list
  const at = list.findIndex((x) => x && x.p && Number(x.p.id) === Number(preTop.id))
  if (at <= 0) return list
  const nowHit = Number((list[0] && list[0].hit) || 0)
  if (hit < nowHit * GUARD_RATIO) return list
  const out = list.slice()
  const moved = out[at]
  out.splice(at, 1)
  // 2026-11-20：原来直接把 preTop.ref 顶到最前。调用方没给 ref 的时候，顶上来的是一条 undefined——
  // 护栏本来防的是「排序被压」，结果自己往名单里塞了个空位。没有 ref 就用原来那条。
  out.unshift(preTop.ref || moved)
  return out
}
