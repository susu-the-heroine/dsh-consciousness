/**
 * 版本号：一套收口
 * ==============
 *
 * 2026-11-14 夜审计：版本号三态并存——main 等写 schemaVersion:3，六个实验海写 version:1，
 * real1000/real3000/evolve_lab 什么都没有，而且全仓库没人读它。
 *
 * 收法（最小改动，不搬家数据）：
 *   - 单键 schemaVersion，当前值 3；
 *   - 读的时候只认这一个键，老的 version:1 视作 schemaVersion:1（detectVersion 兼容）；
 *   - 写的时候统一盖成 3、抹掉旧键 version；
 *   - 号比现在新 → 拒读并记审计（宁可不读，也不能拿新版本的数据按老逻辑改坏）。
 *
 * 从 1 到 3 没有字段迁移（version 从来没人读），所以迁移就是"下次写时归一"，
 * 不需要批量重写任何一个海的文件。
 */

export const CURRENT_SCHEMA = 3

/** 读出有效版本号：schemaVersion 优先，其次 version，都没有算 0 */
export function detectVersion(data) {
  if (!data || typeof data !== 'object') return 0
  const sv = Number(data.schemaVersion)
  if (Number.isFinite(sv) && sv > 0) return sv
  const v = Number(data.version)
  if (Number.isFinite(v) && v > 0) return v
  return 0
}

/** 写前归一：盖当前版本号，抹掉旧键 */
export function stampVersion(data) {
  if (!data || typeof data !== 'object') return data
  data.schemaVersion = CURRENT_SCHEMA
  if ('version' in data) delete data.version
  return data
}
