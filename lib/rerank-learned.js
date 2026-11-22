/**
 * 学出来的重排
 * ============
 *
 * 2026-11-18 加。手搓的几路权重是人拍的；这组权重是从真库三百多道题里学的，
 * 七个特征、七个权重，看得懂也回滚得掉。
 * 2026-11-20 说法改准：文件只在第一次读、之后一直用内存里那份——换 model.json 要**重启 DSH** 才生效；
 * 「换文件即回滚」这句原来夸大了。环境变量关掉那条也一样，启动时定。
 *
 * 只动前十二名内部的顺序，不把外面的拉进来——错了也只错一小段。
 * 关掉：C2_RERANK_MODEL=0
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
let _M = null
let _tried = false

export function loadModel() {
  if (_tried) return _M
  _tried = true
  try {
    if (String(process.env.C2_RERANK_MODEL || '') === '0') return (_M = null)
    const p = join(HERE, '..', 'assets', 'rerank', 'model.json')
    if (!existsSync(p)) return (_M = null)
    const o = JSON.parse(readFileSync(p, 'utf8'))
    if (!o || !Array.isArray(o.w) || o.w.length !== 7) return (_M = null)
    _M = o
    return _M
  } catch {
    return (_M = null)
  }
}

const grams = (s) => {
  const out = new Set()
  const t = String(s || '')
  for (const seg of (t.match(/[\u4e00-\u9fa5]+/g) || [])) {
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2))
  }
  for (const w of (t.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w)
  return out
}

export function featuresOf(q, p, cos) {
  const A = grams(q)
  const B = grams([p.title, p.text, p.alias].filter(Boolean).join(' '))
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  const overlap = A.size ? hit / A.size : 0
  const titleHas = String(p.title || '').includes(String(q || '').trim()) ? 1 : 0
  const aliasHas = p.alias && String(p.alias).includes(String(q || '').trim()) ? 1 : 0
  // 2026-11-21：库里存的字段是复数（entities），单数是老数据的兜底。
  // 这里原来只读单数——实体命中这一路特征在真库上恒为零，等于白学一维。
  const _ents = Array.isArray(p.entities) ? p.entities : (Array.isArray(p.entity) ? p.entity : [])
  const ent = _ents.join(' ')
  const entHit = ent && String(q).includes(String(ent).split(/\s+/)[0] || '__') ? 1 : 0
  const days = Math.min(3650, (Date.now() - (Number(p.born) || 0)) / 86400000)
  const fresh = 1 / (1 + days / 30)
  const lenRatio = Math.min(1, String(q || '').length / Math.max(8, String(p.title || '').length))
  return [overlap, Number(cos) || 0, titleHas, aliasHas, entHit, fresh, lenRatio]
}

export function probOf(f, model = loadModel()) {
  if (!model) return null
  let z = model.b
  for (let i = 0; i < f.length; i++) z += model.w[i] * f[i]
  return 1 / (1 + Math.exp(-z))
}
