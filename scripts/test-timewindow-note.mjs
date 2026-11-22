/**
 * 大跨度时间 · 说明自测
 *
 * 正：问「去年」这种大跨度，回答里要有一句「只按内容找，没按时间卡」。
 * 反：问「昨天」这种小跨度，不许加这句——它确实按时间卡了。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'twnote-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const seaDir = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(seaDir, { recursive: true })
const now = Date.now()
const D = 86400000
writeFileSync(join(seaDir, 'data.json'), JSON.stringify({
  version: 1,
  points: [1, 400].map((d, i) => ({
    id: i + 1,
    title: '那条鱼 ' + d + ' 天前',
    text: '那条鱼的事。',
    kind: 'fact',
    born: now - d * D,
    strength: 40,
    layer: 'experience',
    imp: 0.6,
    arousal: 4,
  })),
  edges: [],
}), 'utf8')

const LIB = 'file:///' + join(process.cwd(), 'lib').replace(/\\/g, '/')
const { searchTool } = await import(LIB + '/tools.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const big = await searchTool.execute({ query: '去年那条鱼', limit: 3, review: false })
t('大跨度要说明', String(big.log).includes('大跨度时间'), String(big.log).slice(0, 40))

const small = await searchTool.execute({ query: '昨天那条鱼', limit: 3, review: false })
t('小跨度不许说明', !String(small.log).includes('大跨度时间'))

const narrow = await searchTool.execute({ query: '昨天那条鱼', limit: 3, review: false })
t('小跨度只回昨天那条', [...String(narrow.log).matchAll(/· #(\d+)/g)].map((m) => m[1]).join(',') === '1')

console.log(`大跨度说明：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
