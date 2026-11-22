/**
 * 嵌入不可用降级 · 正反自测
 *
 * 正：掐掉嵌入，字面照样能找，回答里明说这是没走语义。
 * 反：掐掉嵌入不许报错，也不许假装走通了语义。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'noembed-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
process.env.DSH_SEA_DEBUG = '0'

const seaDir = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(seaDir, { recursive: true })
const now = Date.now()
const pts = [
  { id: 1, title: '经十路那条马路', text: '济南经十路，走了很多年。', kind: 'fact', imp: 0.8, arousal: 6, born: now - 86400000, strength: 40, layer: 'experience' },
  { id: 2, title: '阑尾炎八天吊针', text: '打了八天头孢，第九天吃洋葱圈。', kind: 'fact', imp: 0.7, arousal: 5, born: now - 172800000, strength: 40, layer: 'experience' },
  { id: 3, title: '副业那件事', text: '做短视频当副业，做不起来也不痛。', kind: 'fact', imp: 0.7, arousal: 4, born: now - 259200000, strength: 40, layer: 'experience' },
]
writeFileSync(join(seaDir, 'data.json'), JSON.stringify({ version: 1, points: pts, edges: [] }), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}
const idsOf = (r) => [...String((r && (r.log || r.text)) || '').matchAll(/#(\d+)(?![0-9])/g)].map((m) => Number(m[1]))

process.env.C2_NO_EMBED = '1'
const off = await searchTool.execute({ query: '经十路', limit: 5, review: false }).catch((e) => ({ err: String(e && e.message) }))
t('掐掉嵌入不报错', !off.err, String(off.err))
const offIds = idsOf(off)
t('字面照样能找到', offIds.includes(1), JSON.stringify(offIds))
t('回答里明说没走语义', /语义|字面|直扫/.test(String(off.log || '')), String(off.log || '').slice(0, 60))

delete process.env.C2_NO_EMBED
const on = await searchTool.execute({ query: '经十路', limit: 5, review: false }).catch((e) => ({ err: String(e && e.message) }))
t('恢复后也不报错', !on.err, String(on.err))
t('恢复后仍能命中', idsOf(on).includes(1), JSON.stringify(idsOf(on)))

console.log(`嵌入降级：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
