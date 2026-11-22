import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 海名带中文和空格行不行
 * ======================
 *
 *   node scripts/sea-name-test.mjs
 *
 * 别人起海名不会用 work、private 这种英文：多半是「工作」「家里」「临时 2」。
 * 要验：带中文、带空格、带点的名字，建得出、写得进、读得回、列得出、删得掉。
 *
 * 全程临时家目录。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const NAMES = ['工作', '家里 2', '临时.测试']

if (process.env.DSH_SEA_NAME === '1') {
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
  const SEAS = await import('file:///' + join(HERE, '..', 'lib', 'seas.js').replace(/\\/g, '/'))
  const out = { written: [], read: [], listed: [], deleted: [] }
  const t = Date.now()

  for (const name of NAMES) {
    try {
      S.ensureSea(name)
      const ok = S.writeSea(name, { points: [{ id: 1, title: '在' + name + '里', text: '这个名字能不能用。', bornAt: t, at: t }] }) !== false
      if (ok) out.written.push(name)
      const back = S.readSea(name)
      if (back && back.points && back.points.length === 1) out.read.push(name)
    } catch (e) {
      out.err = String((e && e.message) || e)
    }
  }

  const list = (() => { try { return SEAS.listSeas() } catch { return [] } })()
  const ids = (Array.isArray(list) ? list : []).map((x) => String((x && (x.id || x.name)) || x))
  out.listed = NAMES.filter((n) => ids.includes(n))

  for (const name of NAMES) {
    try {
      rmSync(join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', name), { recursive: true, force: true })
      const gone = !existsSync(join(process.env.USERPROFILE, '.dsh', 'consciousness-seas', name))
      if (gone) out.deleted.push(name)
    } catch {}
  }

  console.log(JSON.stringify(out))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-seaname-'))
const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  // 2026-11-21：跟海隔离那条同一个漏——只改用户目录变量、没改家目录变量。
  // 这台机器够用；换个系统，取家目录看的是另一个变量，子进程就往真家目录里写了。
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_SEA_NAME: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const need = (arr) => Array.isArray(arr) && arr.length === NAMES.length
const ok = need(got.written) && need(got.read) && need(got.listed) && need(got.deleted)
console.log(`写进去 ${got.written.length}/${NAMES.length} · 读回来 ${got.read.length} · 列出来 ${got.listed.length} · 删干净 ${got.deleted.length}`)
if (got.err) console.log('报错：' + String(got.err).slice(0, 120))
console.log(ok ? '中文、空格、点的海名都能用。' : '不对：有些名字写不进去或列不出来。')
process.exit(ok ? 0 : 1)
