/**
 * 重排护栏 · 正反自测
 *
 * 正：字面命中 67 分那条被 17 分的顶到后面，护栏要把它拎回第一。
 * 反：差得不多时不许动——重排有它的道理，别一有不同就翻案。
 * 反：没到四十次命中的，护栏不管。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/rerankguard.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { applyRerankGuard, GUARD_MIN_HIT, GUARD_RATIO } = await import(LIB + '/rerankguard.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}
const mk = (id, hit) => ({ p: { id }, hit })

const strong = mk(54, 67)
const weak1 = mk(42, 17)
const weak2 = mk(30, 12)

const after = [weak1, weak2, strong]
const fixed = applyRerankGuard({ id: 54, hit: 67, ref: strong }, after)
t('被压下去的要拎回第一', fixed[0].p.id === 54, fixed.map((x) => x.p.id).join(','))
t('原来第一掉到第二', fixed[1].p.id === 42, fixed.map((x) => x.p.id).join(','))
t('条数不许变', fixed.length === 3, String(fixed.length))

const close = [mk(42, 60), mk(54, 67)]
const stay = applyRerankGuard({ id: 54, hit: 67, ref: mk(54, 67) }, close)
t('差得不多不翻案', stay[0].p.id === 42, stay.map((x) => x.p.id).join(','))

const lowHits = [mk(42, 20), mk(54, 30)]
const low = applyRerankGuard({ id: 54, hit: 30, ref: mk(54, 30) }, lowHits)
t('命中太少不管', low[0].p.id === 42, low.map((x) => x.p.id).join(','))

const already = [mk(54, 67), mk(42, 17)]
const keep = applyRerankGuard({ id: 54, hit: 67, ref: mk(54, 67) }, already)
t('本来就在第一就不动', keep === already)

t('门槛是四十', GUARD_MIN_HIT === 40, String(GUARD_MIN_HIT))
t('倍数是两点五', GUARD_RATIO === 2.5, String(GUARD_RATIO))

console.log(`重排护栏：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
