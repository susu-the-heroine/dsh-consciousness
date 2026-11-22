/**
 * 语义拒答闸 · 自测
 *
 * 这块只判一个数：问句和头一条的余弦够不够。
 * 真库上量过：编的最高零点零三、真的最低负零点零一，中间有重叠，所以门槛保守、默认不开。
 * 这里只测判定本身，不碰任何识海。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/refusecos.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { shouldRefuseCos, DEFAULT_COS_MIN } = await import(LIB + '/refusecos.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

t('太低要拒', shouldRefuseCos(0.01, 0.05) === true)
t('够高要放', shouldRefuseCos(0.2, 0.05) === false)
t('正好等于门槛放行', shouldRefuseCos(0.05, 0.05) === false)
t('算不出来就放行', shouldRefuseCos(NaN, 0.05) === false)
t('没设门槛就放行', shouldRefuseCos(0.0, 0) === false)
t('默认门槛是零点零五', DEFAULT_COS_MIN === 0.05, String(DEFAULT_COS_MIN))
t('负数余弦要拒', shouldRefuseCos(-0.02, 0.05) === true)

console.log(`语义拒答闸：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
