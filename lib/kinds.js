/**
 * 记忆类型与「设定 vs 经历」
 * ==========================
 *
 * 两种记忆，两套规矩：
 *
 *   设定（setting）——「我是谁」。名字、规矩、禁区、他的身体、老家的路。
 *                     没有发生时间，不衰减，不归档，注入时该一直在。
 *
 *   经历（experience）——「经历过什么」。今天视频爆了、他说我傻。
 *                        有时间，会淡，会被收，靠「被想起」留住。
 *
 * 为什么要有 isSetting：之前只靠 era === 'ds' 判设定，那是「初代大肥鱼」专用的标记。
 * 别人装上这个插件，era 永远是 dsh，一条设定都认不出来。
 */

/** 类型注册表。inject 决定注入策略，forgettable 决定能不能忘 */
export const KINDS = {
  fact:     { indexed: true,  vector: true,  forgettable: true,  inject: 'recall', label: '事实' },
  feeling:  { indexed: true,  vector: true,  forgettable: true,  inject: 'recall', label: '感受' },
  taboo:    { indexed: true,  vector: true,  forgettable: false, inject: 'always', label: '禁区' },
  promise:  { indexed: true,  vector: true,  forgettable: false, inject: 'always', label: '承诺' },
  profile:  { indexed: false, vector: true,  forgettable: false, inject: 'always', label: '画像', singletonPerKey: true },
  event:    { indexed: true,  vector: true,  forgettable: true,  inject: 'recent', label: '事件' },
  state:    { indexed: false, vector: false, forgettable: false, inject: 'none',   label: '状态', singleton: true },
  // 设定：我是谁。名字、规矩、老家的路、他的身体。
  // 跟 fact 的区别：fact 是「发生过一件事」，setting 是「一直是这样」。
  setting:  { indexed: true,  vector: true,  forgettable: false, inject: 'always', label: '设定' },
  // 2026-11-22：风格与自我。
  // style = 「他怎么说话」的观察（口癖、标点、句长、爱骂的词）。不进星图、不参与普通召回，
  //         单独一路挑着注入，最多两条；会淡（人不说话了，习惯也就淡了）。
  // self  = 「她成了什么样」的自述。会叠不会盖，旧条标被推翻；一直在注入里，但只取最新几条。
  style:    { indexed: false, vector: false, forgettable: true,  inject: 'style',  label: '风格' },
  self:     { indexed: false, vector: true,  forgettable: false, inject: 'self',   label: '自我' },
}

export function kindOf(p) {
  const k = String((p && p.kind) || '')
  return KINDS[k] ? k : 'fact'
}

export function kindCfg(p) {
  return KINDS[kindOf(p)]
}

/** 能不能忘 */
export function forgettable(p) {
  return kindCfg(p).forgettable !== false
}

/** 注入策略 */
export function injectMode(p) {
  return kindCfg(p).inject || 'recall'
}

/** 这类记忆是否受单例约束 */
export function isSingleton(p) {
  return kindCfg(p).singleton === true || kindCfg(p).singletonPerKey === true
}

/**
 * 是不是「设定」。
 *
 * 判据（命中任一就是设定）：2026-11-20 逐行核对，按实现把表改准。
 *   1. kind === 'taboo'        禁区，明确不能碰
 *   2. kind === 'setting'      显式标了「这是设定」
 *   3. kind === 'promise'      约定欠着，一年后也得说得出来
 *   4. factKey 有值            事实键，比如 he.weight / he.job
 *   5. layer === 'core'        手动提升过
 * 已删的判据：origin === 'import'（导入不等于身份）、era === 'ds'（来源不是身份）。
 */
export function isSetting(p) {
  if (!p) return false
  const k = String(p.kind || '')
  if (k === 'taboo' || k === 'setting') return true
  if (k === 'promise') return true   // 约定不能淡：欠着的事一年后也得说得出来
  if (p.factKey && String(p.factKey).trim()) return true
  // 2026-11-08：导入不再等于设定。别人把旧聊天导进来，不该永不淡。
  if (String(p.layer || '') === 'core') return true
  // 2026-11-11 删掉 `era === 'ds'`：上一行注释早写了「导入不再等于设定」，
  // 可下一条判据还是把 era 当免死金牌——导入的历史全打 ds，
  // 结果一百多条旧记忆永不衰减。来源不是身份。
  return false
}
