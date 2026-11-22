import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 批注：能加一句，不能改旧正文
 * ==========================
 *
 *   node scripts/annotate-test.mjs
 *
 * 拿沙箱海复制一份到临时家目录里试，真库一个字不碰。
 * 要验三件事：
 *   1. 批注写进去了（notes 多一条，内容是刚写的那句）
 *   2. 旧正文、标题、编号一个都没变
 *   3. 空批注、乱编号会被拒，而且不写盘
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const srcSea = join(homedir(), '.dsh', 'consciousness-seas', 'sandbox')

if (!existsSync(join(srcSea, 'data.json'))) {
  console.log('没有沙箱海，先跑一次装机或者建一个 sandbox 海')
  process.exit(1)
}

if (process.env.DSH_ANNOTATE_CHILD === '1') {
  const home = process.env.USERPROFILE
  const dataPath = join(home, '.dsh', 'consciousness-seas', 'sandbox', 'data.json')
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools-evolve.js').replace(/\\/g, '/'))
  const before = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
  const target = before.points.find((p) => !p.dead && Array.isArray(p.notes) === true) || before.points.find((p) => !p.dead)
  const note = '批注测试：这条是拿来验证的'

  const r1 = await T.annotateTool.execute({ id: target.id, note, sea: 'sandbox' })
  const bad1 = await T.annotateTool.execute({ id: target.id, note: '', sea: 'sandbox' })
  const bad2 = await T.annotateTool.execute({ id: 999999, note, sea: 'sandbox' })

  const after = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
  const p2 = after.points.find((p) => Number(p.id) === Number(target.id))
  const noteIn = Array.isArray(p2.notes) && p2.notes.some((n) => n && String(n.text || '').includes('批注测试'))
  const bodySame = String(p2.title || '') === String(target.title || '') && String(p2.text || '') === String(target.text || '')
  const countSame = after.points.length === before.points.length

  console.log(JSON.stringify({
    ok: Boolean(r1 && r1.ok),
    noteIn,
    bodySame,
    countSame,
    badEmptyRejected: !(bad1 && bad1.ok),
    badIdRejected: !(bad2 && bad2.ok),
  }))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-annot-'))
mkdirSync(join(home, '.dsh', 'consciousness-seas'), { recursive: true })
cpSync(srcSea, join(home, '.dsh', 'consciousness-seas', 'sandbox'), { recursive: true })

const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 60000,
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_ANNOTATE_CHILD: '1' },
})
// 2026-11-21：清理没兜住。写库那边句柄还没放时，Windows 删目录报拒绝——
// 六项判定全过，退出码还是被这行变成一，看着像测试挂了。删不掉就留着、说一声。
try { rmSync(home, { recursive: true, force: true }) } catch { console.log('临时目录没删掉（有句柄占着？），留着：' + home) }

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

console.log(`写入 ${got.ok ? '成' : '败'} · 批注在 ${got.noteIn ? '是' : '否'} · 正文没动 ${got.bodySame ? '是' : '否'}`
  + ` · 条数没变 ${got.countSame ? '是' : '否'} · 空批注被拒 ${got.badEmptyRejected ? '是' : '否'} · 乱编号被拒 ${got.badIdRejected ? '是' : '否'}`)

const ok = got.ok && got.noteIn && got.bodySame && got.countSame && got.badEmptyRejected && got.badIdRejected
console.log(ok ? '批注能加，旧正文没被改。' : '不对：要么没写进去，要么把旧正文动了。')
process.exit(ok ? 0 : 1)
