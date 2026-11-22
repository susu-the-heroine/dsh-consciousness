/**
 * 重启后验「别名能不能存」
 * ======================
 *   node scripts/verify-alias-live.mjs
 *
 * 为什么单独写：改的是插件里的接口，盘上好看不算数，得等活着那份吃到新代码。
 * 只碰沙箱海（sea=sandbox），不往主海写。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
const SEA = 'sandbox'
const PORT = process.env.DSH_PLUGIN_PORT || '55940'
const ID = 990001

const S = await import('file:///' + join(process.cwd(), 'lib', 'store.js').replace(/\\/g, '/'))
S.ensureSea(SEA)
const cur = S.readSea(SEA)
if (!cur.points.some((p) => Number(p.id) === ID)) {
  cur.points.push({ id: ID, title: '别名活体验证', text: '临时条目，验完删除。', kind: 'fact', born: Date.now(), seen: 0 })
  S.writeSea(SEA, cur)
}

const alias = '楼下早点摊豆浆多少钱'
const r = await fetch('http://127.0.0.1:' + PORT + '/consciousness/edit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sea: SEA, id: ID, title: '别名活体验证', text: '临时条目，验完删除。', alias }),
})
const j = await r.json().catch(() => ({}))
const after = S.readSea(SEA).points.find((p) => Number(p.id) === ID)

console.log('  接口回：' + JSON.stringify(j).slice(0, 80))
console.log('  落盘的 alias：' + JSON.stringify(after && after.alias))
console.log('  判定：' + (after && after.alias === alias ? '过——新代码吃到了' : '不过——活在的还是旧代码，或者存盘那步没接上'))

// 验完把临时条目删掉，别留垃圾
const fin = S.readSea(SEA)
fin.points = fin.points.filter((p) => Number(p.id) !== ID)
S.writeSea(SEA, fin)
console.log('  临时条目已清：' + (S.readSea(SEA).points.some((p) => Number(p.id) === ID) ? '还在（要手动清）' : '干净'))
