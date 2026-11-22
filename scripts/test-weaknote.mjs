/**
 * 「对得不准」提示 · 正反自测
 *
 * 正：库里没有的事被答了，答案里必须带一句自己对得不准。
 * 反：库里有的、问得准的，一个字都不许多。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/tools.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'weak-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const seaDir = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(seaDir, { recursive: true })
const now = Date.now()
const pts = []
for (let i = 1; i <= 40; i++) {
  pts.push({
    id: i,
    title: i === 1 ? '经十路那条马路' : i === 2 ? '阑尾炎八天吊针' : '普通记忆第' + i + '条',
    text: i === 1 ? '济南经十路，走了很多年。' : i === 2 ? '打了八天头孢，第九天吃洋葱圈。' : '一件普通的事，编号' + i,
    kind: 'fact', imp: 0.6, arousal: 4, born: now - i * 3600000, strength: 30, layer: 'experience',
  })
}
writeFileSync(join(seaDir, 'data.json'), JSON.stringify({ version: 1, points: pts, edges: [] }), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const fake = await searchTool.execute({ query: '量子纠缠冰箱怎么修', limit: 2, review: false })
const real = await searchTool.execute({ query: '经十路', limit: 2, review: false })
const fl = String(fake.log || '')
const rl = String(real.log || '')

t('编的问题：要么拒答、要么带一句不准', /没记过|没记住/.test(fl) || fl.includes('对得不准'), fl.slice(0, 60))
t('编的问题：不许静默硬答', /没记过|没记住|对得不准/.test(fl), fl.slice(0, 60))
t('真问题：不许乱标', !rl.includes('对得不准'), rl.slice(0, 60))
t('真问题：照样有结果', /· #\d+/.test(rl))

console.log(`对得不准提示：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
