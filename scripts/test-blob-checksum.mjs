/**
 * 二进制块校验和
 * ==============
 *   node scripts/test-blob-checksum.mjs
 *
 * 正常写进去能读；块被改坏要认得出来，并整本作废重建。
 * 全程临时目录，不碰他的库。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-ck-'))
process.env.C2_VERIFY_BLOB = '1'
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

// 2026-11-21：按当前目录找库，换个目录跑就断。改成按本文件位置算。
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const V = await import(LIB + '/vecstore.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const sea = 'bk'
mkdirSync(join(SEAS_DIR, sea), { recursive: true })

V.putMany(sea, [{ id: 1, v: Float32Array.from([1, 2, 3, 4]), h: 'a' }])
V.putMany(sea, [{ id: 2, v: Float32Array.from([5, 6, 7, 8]), h: 'b' }])

const idx1 = V.readIdx(sea)
ok('写进去有账本', Object.keys(idx1.ids).length === 2, JSON.stringify(Object.keys(idx1.ids)))
ok('账本记了块大小与哈希', !!(idx1.blob && idx1.blob.h), JSON.stringify(idx1.blob))
ok('读得回向量', !!V.readVec(sea, 1) && V.readVec(sea, 1)[0] === 1)

const bin = join(SEAS_DIR, sea, 'vectors.bin')
const buf = readFileSync(bin)
buf[0] = buf[0] ^ 0xff   // 弄坏一个字节
writeFileSync(bin, buf)

const idx2 = V.readIdx(sea)
ok('坏块被认出来', idx2.staleBlob === true, JSON.stringify({ staleBlob: idx2.staleBlob, n: idx2.n }))
ok('坏块读不出向量（当它作废）', V.readVec(sea, 1) === null)

V.putMany(sea, [{ id: 3, v: Float32Array.from([9, 9, 9, 9]), h: 'c' }])
const idx3 = V.readIdx(sea)
ok('重建后能再用', Object.keys(idx3.ids).length === 1 && !!idx3.blob.h)

console.log(`\n二进制块校验自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
