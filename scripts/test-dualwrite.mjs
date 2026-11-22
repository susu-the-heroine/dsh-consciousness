/**
 * 换模型双写自测
 * ==============
 *   node scripts/test-dualwrite.mjs
 *
 * 配了影子槽：同一批向量在两本账里各有一份，模型名各记各的。
 * 没配影子槽：只写主账，影子账不动。
 */
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/vecstore.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-dual-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const VX = await import(LIB + '/vecstore.js')
const { SEAS_DIR } = await import(LIB + '/paths.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

const sea = 'dw'
mkdirSync(join(SEAS_DIR, sea), { recursive: true })
const vec = (k) => Float32Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + k))

VX.putMany(sea, [{ id: 1, v: vec(1), h: 'a' }, { id: 2, v: vec(2), h: 'b' }])
ok('没配影子：影子文件不出现', !existsSync(join(SEAS_DIR, sea, 'vectors.alt.bin')))

process.env.C2_VEC_SHADOW = 'alt'
VX.putMany(sea, [{ id: 3, v: vec(3), h: 'c' }])

const sIdx = join(SEAS_DIR, sea, 'vectors.alt.idx.json')
ok('配了影子：影子账本出现', existsSync(sIdx) && existsSync(join(SEAS_DIR, sea, 'vectors.alt.bin')))
const sj = JSON.parse(readFileSync(sIdx, 'utf8'))
ok('影子账本记模型名', sj.model === 'alt', String(sj.model))
ok('影子账本条数对得上', Object.keys(sj.ids || {}).length === 1, JSON.stringify(Object.keys(sj.ids || {})))
ok('主账没被顶掉', Object.keys(VX.readIdx(sea).ids).length === 3, String(Object.keys(VX.readIdx(sea).ids).length))

VX.putMany(sea, [{ id: 4, v: vec(4), h: 'd' }])
const sj2 = JSON.parse(readFileSync(sIdx, 'utf8'))
ok('影子账本跟着长', Object.keys(sj2.ids || {}).length === 2, String(Object.keys(sj2.ids || {}).length))

console.log(`\n双写自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
