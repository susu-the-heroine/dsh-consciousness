/**
 * 时态择向 · 正反自测
 *
 * 正：问「当时」，在分差不大的人里把最老的挪到第一。
 * 正：问「现在」，把最新的挪到第一。
 * 反：不问时态、或两条都带时态词，一律不动。
 * 反：分差超过一成五的，不翻案——分高就是分高。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：库按当前目录找——换个目录跑就报找不到 file:///C:/lib/tense.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { applyTenseRank, tenseOf } = await import(LIB + '/tense.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const D = 86400000
const now = Date.now()
const fresh = { p: { id: 1, born: now - 2 * D }, score: 1.0 }
const old = { p: { id: 2, born: now - 200 * D }, score: 0.95 }
const base = [fresh, old]

t('「当时」认得出来', tenseOf('他当时打算干什么') === 'past', tenseOf('他当时打算干什么'))
t('「现在」认得出来', tenseOf('他现在打算干什么') === 'now', tenseOf('他现在打算干什么'))
t('不带时态词返回空', tenseOf('他打算干什么') === '', tenseOf('他打算干什么'))

const past = applyTenseRank('他当时打算干什么', base)
t('问当时，老的那条上第一', past[0].p.id === 2, past.map((x) => x.p.id).join(','))

const nowRank = applyTenseRank('他现在打算干什么', [old, fresh])
t('问现在，新的那条上第一', nowRank[0].p.id === 1, nowRank.map((x) => x.p.id).join(','))

const plain = applyTenseRank('他打算干什么', base)
t('不带时态不动顺序', plain[0].p.id === 1, plain.map((x) => x.p.id).join(','))

const far = [{ p: { id: 1, born: now }, score: 1.0 }, { p: { id: 2, born: now - 100 * D }, score: 0.5 }]
const keep = applyTenseRank('他当时说过什么', far)
t('分差太大不翻案', keep[0].p.id === 1, keep.map((x) => x.p.id).join(','))

const both = applyTenseRank('他当时和现在有什么不同', base)
t('两头都带时态词就原样', both[0].p.id === 1, both.map((x) => x.p.id).join(','))

const one = applyTenseRank('他当时说过什么', [fresh])
t('只有一条时原样返回', one.length === 1 && one[0] === fresh)

console.log(`时态择向：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
