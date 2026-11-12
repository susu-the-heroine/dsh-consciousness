/**
 * 调参口 · tuning
 * ==============
 *
 * 排位那几个数字（向量门槛、标题加权、实体加权、同义词桥）不放死在代码里。
 * 读 ~/.dsh/consciousness-tuning.json，文件改了就生效，不用重启。
 *
 * 为什么要这么干：改一次数要重启一次、量一次要重启一次，一天重启十来回。
 * 参数放进文件，改文件立刻能量下一组数。
 *
 * 默认值 = 当前线上行为，文件不存在时就是它。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-tuning.json')

export const DEFAULTS = {
  vecMin: 0.4,      // 向量纳入门槛
  titleBoost: 3,    // 标题字命中一次加多少
  entBoost: 5,      // 实体名出现在问句里加多少
  synonym: {},      // 同义词桥：{"死": ["葬礼","消失"]}
}

let _cache = null
let _at = 0

export function tuning() {
  try {
    if (!existsSync(FILE)) return DEFAULTS
    const mt = statSync(FILE).mtimeMs
    if (_cache && mt === _at) return _cache
    const j = JSON.parse(readFileSync(FILE, 'utf8'))
    _cache = { ...DEFAULTS, ...(j && typeof j === 'object' ? j : {}) }
    _at = mt
    return _cache
  } catch {
    return DEFAULTS
  }
}

/** 把问句的词按同义词桥扩一圈：返回额外要参与匹配的词 */
export function expandTerms(query) {
  const t = tuning()
  const out = []
  const syn = t.synonym && typeof t.synonym === 'object' ? t.synonym : {}
  for (const [k, arr] of Object.entries(syn)) {
    if (!k || !query.includes(k)) continue
    for (const v of (Array.isArray(arr) ? arr : [])) {
      const w = String(v || '').trim()
      if (w) out.push(w)
    }
  }
  return out
}
