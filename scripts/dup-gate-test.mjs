/**
 * 写前近重复检测
 * ================
 *
 *   node scripts/dup-gate-test.mjs
 *
 * 临时 HOME 里建一个海，试三件：
 *   1. 先写一条；再用几乎一样的正文写第二条 → 被挡，库里还是 1 条；
 *   2. 写一条完全不同的 → 放行，库里 2 条；
 *   3. 重复那条带 force:true → 硬写，库里 3 条。
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const tmp = mkdtempSync(join(tmpdir(), 'c2-dup-'))
process.env.USERPROFILE = tmp
mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })

// 2026-11-21：写死的本机绝对路径第五处。改成按本文件位置算。
const T = await import('file:///' + join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())
const add = Object.values(T).find((v) => v && typeof v === 'object' && v.name === 'memory_add')

const sea = 'duptest'
const N = () => JSON.parse(readFileSync(join(tmp, '.dsh', 'consciousness-seas', sea, 'data.json'), 'utf8')).points.length

let bad = 0
await add.execute({ sea, title: '阑尾炎那八天', text: '他阑尾炎打了八天吊针，两头都是头孢，第九天才不疼。' })
const n1 = N()
await add.execute({ sea, title: '阑尾炎那八天', text: '他阑尾炎打了八天吊针，两头都是头孢，第九天才不疼。' })
const n2 = N()
if (n2 !== n1) { bad++; console.log('挂  重复正文没被挡（' + n1 + '→' + n2 + '）') }
else console.log('过  重复正文被挡，库里还是 ' + n2 + ' 条')

await add.execute({ sea, title: '经十路的夜风', text: '深夜他骑车在经十路上吹风，说这条马路走不到头。' })
const n3 = N()
if (n3 !== n1 + 1) { bad++; console.log('挂  不同正文没放行') }
else console.log('过  不同正文正常写入，' + n3 + ' 条')

const forced = await add.execute({ sea, title: '阑尾炎那八天（又记一次）', text: '他阑尾炎打了八天吊针，两头都是头孢，第九天才不疼，这回是补细节。', force: true })
const n4 = N()
if (n4 !== n3 + 1 || /没写进库里/.test(String(forced.log || ''))) { bad++; console.log('挂  force:true 没硬写') }
else console.log('过  force:true 硬写，' + n4 + ' 条')

console.log(bad ? `不对：${bad} 处。` : '写前查重：重复挡、不同放、force 硬写。')
process.exit(bad ? 1 : 0)
