/**
 * 备份带上向量与账本
 * ====================
 *   node scripts/test-backup-vectors.mjs
 *
 * 记忆本体、向量、账本三样一起备；回滚时不用再重建向量。
 * 全程临时目录。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/store.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'sea-bk-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { writeSea, backupSea } = await import(LIB + '/store.js')
const { SEAS_DIR, BACKUP_DIR } = await import(LIB + '/paths.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) } }

writeSea('main', { version: 3, points: [{ id: 1, title: 'a', text: 'b' }], edges: [] })
const seaDir = join(SEAS_DIR, 'main')
writeFileSync(join(seaDir, 'vectors.json'), JSON.stringify({ 1: { h: 'x', v: [1, 2] } }), 'utf8')
writeFileSync(join(seaDir, 'vectors.bin'), Buffer.from([1, 2, 3, 4]), 'binary')
writeFileSync(join(seaDir, 'vectors.idx.json'), JSON.stringify({ ids: {} }), 'utf8')

backupSea('main')
const dir = join(BACKUP_DIR, 'main')
const files = readdirSync(dir)
const hasMain = files.some((f) => /^\d{8}-\d{6}\.json$/.test(f))
const sides = files.filter((f) => /^\d{8}-\d{6}\.vectors\.(json|bin)$/.test(f))
ok('记忆本体备了', hasMain, files.join(','))
ok('向量两份都备了', sides.length === 2, sides.join(','))
ok('账本也备了', files.some((f) => /\.vectors\.idx\.json$/.test(f)), files.join(','))

// 多备几次，副档数量不该失控：每一代最多三份
for (let i = 0; i < 6; i++) backupSea('main')
const files2 = readdirSync(dir)
const after = files2.filter((f) => /\.vectors\./.test(f))
// 2026-11-21：这条原名写着「≤ 主备份数×3」，可阈值写的是死数 300——实测七次备份下来副档总共三份，
// 300 这个线等于永真，什么都没守住。改成按实际主备份份数算，名字才和判据对上。
const mainN = Math.max(1, files2.filter((f) => /^\d{8}-\d{6}\.json$/.test(f)).length)
ok('副档不会无限堆（≤ 主备份数×3）', after.length <= mainN * 3, after.length + ' 份，主备份 ' + mainN + ' 份')

console.log(`\n备份带向量自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
