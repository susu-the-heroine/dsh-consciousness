/**
 * 判错落盘 · 正反自测
 *
 * 正：检索过之后判错，不用另传问句，文件里也要真多一行。
 * 反：判「对」不许写负样本；显式传的问句优先于自动记的。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'judge-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const seaDir = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(seaDir, { recursive: true })
writeFileSync(join(seaDir, 'data.json'), JSON.stringify({
  version: 1,
  points: [{ id: 1, title: '那条鱼的记录', text: '那条鱼的事。', kind: 'fact', born: Date.now() - 86400000, strength: 40, layer: 'experience', imp: 0.6, arousal: 4 }],
  edges: [],
}), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const T = await import(LIB + '/tools.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

await T.searchTool.execute({ query: '那条鱼', limit: 3, review: false })
const fp = join(home, '.dsh', 'consciousness', 'feedback.jsonl')
const lines = () => (existsSync(fp) ? readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean).length : 0)
const before = lines()

const j1 = await T.judgeTool.execute({ log_id: 'x', verdict: 'miss', expect_id: 1 })
t('不传问句也能落盘', j1.ok === true, JSON.stringify(j1).slice(0, 60))
t('文件里真的多一行', lines() === before + 1, `${before} → ${lines()}`)
t('行里带问题原话', /那条鱼/.test(existsSync(fp) ? readFileSync(fp, 'utf8') : ''), '')

const j2 = await T.judgeTool.execute({ log_id: 'x', verdict: 'hit', expect_id: 1 })
t('判对不写负样本', j2.ok === true && lines() === before + 1, `${lines()}`)

const j3 = await T.judgeTool.execute({ log_id: 'x', verdict: 'wrong', expect_id: 1, q: '显式那句' })
t('显式问句优先', j3.ok === true && /显式那句/.test(readFileSync(fp, 'utf8')), '')

console.log(`判错落盘：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
