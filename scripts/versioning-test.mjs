/**
 * 版本号一套收口
 * ==============
 *
 *   node scripts/versioning-test.mjs
 *
 * 在临时 HOME 里建海试三件：
 *   1. 老的 version:1 还能读（兼容，不搬家数据）；
 *   2. 写一次之后 schemaVersion 盖成 3、旧键 version 抹掉；
 *   3. schemaVersion 比现在新（99）→ 拒读，返回 null，不动文件。
 *
 * 全部落在临时目录，不碰真库。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const tmp = mkdtempSync(join(tmpdir(), 'c2-ver-'))
process.env.USERPROFILE = tmp
mkdirSync(join(tmp, '.dsh', 'consciousness-seas'), { recursive: true })

// 2026-11-21：写死的本机绝对路径第四处。改成按本文件位置算。
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')
const S = await import('file:///' + PLUGIN + '/lib/store.js')
const V = await import('file:///' + PLUGIN + '/lib/versioning.js')

let bad = 0

// 1) 老 version:1 兼容
const dir = join(tmp, '.dsh', 'consciousness-seas', 'vtest')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'data.json'), JSON.stringify({ version: 1, points: [{ id: 1, title: '旧海一条' }] }), 'utf8')
let d = S.readSea('vtest')
if (!d || d.points.length !== 1 || V.detectVersion(d) !== 1) { bad++; console.log('挂  老的 version:1 读不回来') }
else console.log('过  version:1 老海还能读')

// 2) 写一次 → 盖 3、抹旧键
S.writeSea('vtest', d)
const raw = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'))
if (raw.schemaVersion !== 3 || 'version' in raw) { bad++; console.log('挂  写后版本键没收成一套') }
else console.log('过  写后 schemaVersion=3，旧键已抹')

// 3) 太新拒读
writeFileSync(join(dir, 'data.json'), JSON.stringify({ schemaVersion: 99, points: [] }), 'utf8')
const blocked = S.readSea('vtest')
if (blocked !== null) { bad++; console.log('挂  版本 99 没被拒') }
else console.log('过  版本 99 拒读（返回 null，不动文件）')

console.log(bad ? `不对：${bad} 处。` : '版本号：老海能读、写入归一、太新拒读。')
process.exit(bad ? 1 : 0)
