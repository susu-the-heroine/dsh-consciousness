/**
 * 置信标记 · 正反自测
 *
 * 正：估出来的时间、说不准的内容，回答里必须带「大概是」。
 * 反：确定性高的（显式日期、有人核过、规矩类）一条都不许乱标。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const U = await import(LIB + '/uncertainty.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const now = Date.now()
const guess = { id: 1, title: '经十路那次', text: '走了很久', kind: 'fact', born: now, bornEstimated: true, confidence: 0.3 }
const solid = { id: 2, title: '本名', text: '你本名是大肥鱼', kind: 'setting', born: now, bornEstimated: false, confidence: 0.95, verifiedAt: now }
const rule = { id: 3, title: '吸烟与喝酒', text: '不许劝', kind: 'taboo', born: now, bornEstimated: false, confidence: 0.95 }

const mg = U.markText(guess)
t('估时的带「大概是」', mg.includes('大概是'), mg)
t('估时的说清是估的', mg.includes('估'), mg)
t('确定的不标', U.markText(solid) === '', U.markText(solid))
t('规矩不标', U.markText(rule) === '', U.markText(rule))
t('shouldMark 认得出估时', U.shouldMark(guess) === true)
t('shouldMark 不冤枉确定项', U.shouldMark(solid) === false)
t('空对象不炸', typeof U.markText({}) === 'string')
t('标记是括号包住的', mg.startsWith('（') && mg.endsWith('）'), mg)

console.log(`置信标记：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
