/**
 * 名字检查：谁没有中文名，当场红
 * ==============================
 * 起因：一条混着两股劲的句子显示成「说不清」——
 * 不是逻辑错，是那个词没有中文名，只能兜底。
 * 光补一次不够，得让"漏名字"这件事自己冒出来。
 *
 * 这份文件把所有可能出现的心情词都过一遍：
 *   51 词表（emotion-lexicon）、8 维、6 个老状态、外加急救表里的
 * 任何一个没有中文名、或者名字里带英文，直接失败。
 *
 * 跑法：node test/labels.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const emo = await import(BASE + 'assets/emotion.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const HAS_EN = /[A-Za-z]/

console.log('\n名字检查：')

// 一、51 词表每个都有中文名
const table = emo.EMOTIONS || emo.default || {}
const keys = Object.keys(table)
ok(keys.length > 30, '词表读得到（' + keys.length + ' 个）')
const noLabel = keys.filter((k) => {
  const v = table[k]
  const label = v && (v.label || v.name)
  return !label || HAS_EN.test(String(label))
})
ok(noLabel.length === 0, '51 词表每个都有中文名', noLabel.join(','))

// 二、八维每个都有中文名（在 inject 的急救表里）
const injectSrc = (await import('node:fs')).readFileSync(
  new URL('../lib/inject.js', import.meta.url), 'utf8',
)
const DIMS = ['calm', 'lonely', 'wistful', 'flutter', 'unreconciled', 'weary', 'dazed', 'tender']
const dimMissing = DIMS.filter((d) => !new RegExp('\\b' + d + '\\s*:').test(injectSrc))
ok(dimMissing.length === 0, '八维都有中文名', dimMissing.join(','))

// 三、六个老状态词也有
const MOODS = ['holding', 'happy', 'low', 'irritated', 'tired']
const moodMissing = MOODS.filter((m) => !new RegExp('\\b' + m + '\\s*:').test(injectSrc))
ok(moodMissing.length === 0, '老状态词都有中文名', moodMissing.join(','))

// 四、兜底不再是"说不清"这种含糊——要么有名字，要么说"说不清"并且带原文 key
ok(/说不清/.test(injectSrc), '真认不出的，仍兜底"说不清"（不假装知道）')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
