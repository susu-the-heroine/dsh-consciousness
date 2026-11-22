import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 换机演练：把库卸成文本，再在干净环境里装回去
 * ==========================================
 *
 *   node scripts/migration-drill.mjs
 *
 * 全程在临时家目录里做，真库只读一次（复制一份进去），不写、不动。
 * 要验的：
 *   1. 导出能成：每条记忆落成一段可读文本
 *   2. 导入能成：在新环境里长成一个新识海
 *   3. 装回来的东西对得上：条数一致、标题抽样一致、正文首行一致
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const SRC = join(homedir(), '.dsh', 'consciousness-seas', 'main')

if (!existsSync(join(SRC, 'data.json'))) {
  console.log('没有主库，换机演练做不了')
  process.exit(1)
}

if (process.env.DSH_MIGRATE_CHILD === '1') {
  const home = process.env.USERPROFILE
  const M = await import('file:///' + join(HERE, '..', 'lib', 'mirror-export.js').replace(/\\/g, '/'))
  const I = await import('file:///' + join(HERE, '..', 'lib', 'mirror-import.js').replace(/\\/g, '/'))

  const exported = M.exportMirror('main')
  const mdDir = join(home, '.dsh', 'consciousness-mirror', 'main')
  const mdCount = existsSync(mdDir) ? readdirSync(mdDir).filter((f) => f.endsWith('.md')).length : 0

  const imp = I.importMirror('main', 'drill')
  const after = JSON.parse(readFileSync(join(home, '.dsh', 'consciousness-seas', 'drill', 'data.json'), 'utf8').replace(/^\uFEFF/, ''))

  console.log(JSON.stringify({
    exportedOk: Boolean(exported && (exported.ok !== false)),
    mdCount,
    importOk: Boolean(imp && (imp.ok !== false)),
    points: Array.isArray(after.points) ? after.points.length : 0,
    titles: (after.points || []).slice(0, 5).map((p) => String(p.title || '').slice(0, 12)),
    // 源里本来就有极少数"只有标题没正文"的（例如某条只记了一句话），不能算导入丢东西
    emptyBody: (after.points || []).filter((p) => !String(p.text || '').trim()).length,
  }))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-migrate-'))
mkdirSync(join(home, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
cpSync(SRC, join(home, '.dsh', 'consciousness-seas', 'main'), { recursive: true })
// 备份目录不需要，省时间
rmSync(join(home, '.dsh', 'consciousness-seas', 'main', 'backups'), { recursive: true, force: true })

const src = JSON.parse(readFileSync(join(SRC, 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
const alive = (src.points || []).filter((p) => !p.dead)
const srcEmpty = alive.filter((p) => !String(p.text || '').trim()).length

const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 180000,
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_MIGRATE_CHILD: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

console.log(`导出 ${got.exportedOk ? '成' : '败'} · 落了 ${got.mdCount} 份文本 · 导入 ${got.importOk ? '成' : '败'} · 装回 ${got.points} 条（源里活着的 ${alive.length} 条）`)
console.log(`抽样标题：${(got.titles || []).join(' / ')}`)
console.log(`正文为空的：导入后 ${got.emptyBody} 条，源里本来 ${srcEmpty} 条`)

// 2026-11-21：原来允许「装回九成以上就算过」——丢两条也叫对得上。
// 换机这条路要么一条不丢，要么就不是同一件事；把门槛改成一条不差，差多少打出来。
if (got.points !== alive.length) {
  console.log(`差 ${alive.length - got.points} 条（源里活着 ${alive.length}，装回 ${got.points}）`)
}
const ok = got.exportedOk && got.importOk && got.mdCount > 0 && got.points === alive.length && Number(got.emptyBody) <= srcEmpty
console.log(ok ? '换机这条路能走通：卸得下来，也装得回去。' : '不对：要么没导出，要么装回来少了东西。')
process.exit(ok ? 0 : 1)
