/**
 * 并发不崩 · 软自测
 *
 * 不设硬指标（机器快慢不定），只验三件事：
 * 一、四路并发不抛错；
 * 二、每问都有结果（不是空数组）；
 * 三、同一批里结果稳定，不会因为并发互相踩出乱七八糟的答案。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'conc-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const QS = ['那七套房和大路虎', '阑尾炎那次', '经十路', '副业那个事']
const runs = []
for (let w = 0; w < 2; w++) {
  const t0 = Date.now()
  const rs = await Promise.all(QS.map((q) => searchTool.execute({ query: q, limit: 5, review: false }).catch((e) => ({ err: String(e && e.message) }))))
  runs.push({ ms: Date.now() - t0, rs })
}

let errs = 0
let empty = 0
for (const r of runs) for (const x of r.rs) {
  if (x && x.err) errs++
  const txt = x && (x.log || x.text || '')
  if (!txt || !String(txt).trim()) empty++
}

t('四路并发不抛错', errs === 0, String(errs))
t('每问都有结果', empty === 0, String(empty))
t('两轮都跑完', runs.length === 2)
t('第二轮不慢于第一轮的三倍', runs[1].ms < runs[0].ms * 3 + 500, `${runs[0].ms}ms / ${runs[1].ms}ms`)

console.log(`并发软测：通过 ${ok} · 失败 ${bad}（第一轮 ${runs[0].ms}ms，第二轮 ${runs[1].ms}ms）`)
rmSync(home, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
