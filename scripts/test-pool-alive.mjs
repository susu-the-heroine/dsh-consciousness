/**
 * 线程池探活 · 软自测
 *
 * 之前两次卡死，谁也不知道是死是慢。这条测试的意义只有一个：
 * 子线程能在十秒内回话，回的是结果不是错误。
 *
 * 十秒不是性能指标——性能另有用例。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/searchpool.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

// 只碰沙箱：造一个只有两条记忆的海，子线程也要读这个
const home = mkdtempSync(join(tmpdir(), 'pool-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
const seaDir = join(home, '.dsh', 'consciousness-seas', 'main')
mkdirSync(seaDir, { recursive: true })
writeFileSync(join(seaDir, 'data.json'), JSON.stringify({
  version: 1,
  points: [
    { id: 1, title: '经十路那条路', text: '济南经十路，走了很多年。', kind: 'fact', imp: 0.8, arousal: 6, born: Date.now() - 86400000 },
    { id: 2, title: '七套房与大路虎', text: '家里七套房，出门开大路虎。', kind: 'fact', imp: 0.7, arousal: 5, born: Date.now() - 172800000 },
  ],
  edges: [],
}), 'utf8')

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const pool = await import(LIB + '/searchpool.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

const t0 = Date.now()
let out = null
let err = ''
try {
  out = await Promise.race([
    pool.search({ query: '经十路', limit: 3, review: false }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('10 秒没回话')), 10000)),
  ])
} catch (e) {
  err = String((e && e.message) || e)
}
const ms = Date.now() - t0

t('子线程十秒内回话', !!out, err || '没结果')
t('回的是结果不是错误', !!out && !(out && out.err), JSON.stringify(out && out.err))
t('结果里有东西', !!out && String(out.log || out.text || '').length > 0)
t('没有卡死（耗时可控）', ms < 10000, ms + 'ms')

console.log(`线程池探活：通过 ${ok} · 失败 ${bad}（${ms}ms）`)
process.exit(bad ? 1 : 0)
