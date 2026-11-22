import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 记错了，三种改法都得真能改
 * ==========================
 *
 *   node scripts/correction-test.mjs
 *
 * 三条主线里最后一条是"被说错就改"。批注单独测过，另外两种（压可信度、钉时间）
 * 一直只写在文档里。这里一起验：改完正文不许变，别的字段该变的要变。
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

// 安全闸：必须跑在临时家目录里，绝不碰真库
if (process.env.DSH_CORRECTION === '1') {
  const { homedir } = await import('node:os')
  if (!/c2-fix-/.test(homedir())) {
    console.log(JSON.stringify({ fatal: '没跑在临时目录，拒绝执行' }))
    process.exit(2)
  }
  const S = await import('file:///' + join(HERE, '..', 'lib', 'store.js').replace(/\\/g, '/'))
  const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/'))
  const E = await import('file:///' + join(HERE, '..', 'lib', 'tools-evolve.js').replace(/\\/g, '/'))
  const U = await import('file:///' + join(HERE, '..', 'lib', 'tools-uncertain.js').replace(/\\/g, '/'))
  // 按工具名找，不按导出变量名找：批注在 evolve 里、压可信度在 uncertain 里
  const ALL = {}
  for (const mod of [T, E, U]) for (const v of Object.values(mod)) if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.startsWith('memory_')) ALL[v.name] = v
  const out = {}

  const t = Date.now()
  try { S.ensureSea('fix') } catch {}
  const text = '正文原句：那天下午三点在楼下抽了一根。'
  S.writeSea('fix', { points: [{ id: 1, title: '楼下那根烟', text, bornAt: t, at: t, strength: 90, imp: 0.7 }] })

  const call = async (name, args) => {
    const obj = ALL[name]
    if (!obj) return { missing: true }
    try { return await obj.execute(args, {}) } catch (e) { return { err: String(e && e.message) } }
  }

  const read = () => S.readSea('fix').points.find((p) => p.id === 1)

  const ann = await call('memory_annotate', { sea: 'fix', id: 1, note: '后来补一句：不是三点，是四点半。' })
  const afterAnn = read()
  out.annotateOk = Boolean(ann && ann.ok !== false)
  out.noteAdded = Array.isArray(afterAnn.notes) && afterAnn.notes.some((n) => String(n.text || '').includes('四点半'))
  out.textKeptAfterAnnotate = String(afterAnn.text || '').startsWith('正文原句')

  const doub = await call('memory_doubt', { sea: 'fix', id: 1, why: '时间对不上' })
  const afterDoubt = read()
  out.doubtOk = Boolean(doub && doub.ok !== false)
  out.confidenceDropped = Number(afterDoubt.conf || afterDoubt.confidence || 1) <= 0.3
  out.textKeptAfterDoubt = String(afterDoubt.text || '').startsWith('正文原句')

  const dat = await call('memory_date', { sea: 'fix', id: 1, when: '11-02 晚上' })
  const afterDate = read()
  out.dateOk = Boolean(dat && dat.ok !== false)
  out.timePinned = JSON.stringify(afterDate) !== JSON.stringify(afterDoubt)
  out.textKeptAfterDate = String(afterDate.text || '').startsWith('正文原句')

  out.countStable = S.readSea('fix').points.length === 1
  console.log(JSON.stringify(out))
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'c2-fix-'))
const r = spawnSync(_nodeBin, [SELF], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, USERPROFILE: home, HOME: home, DSH_CORRECTION: '1' },
})
rmSync(home, { recursive: true, force: true })

let got = null
try { got = JSON.parse(String(r.stdout || '').trim().split('\n').pop()) } catch {}
if (!got) {
  console.log('子进程没给出结果：' + String(r.stdout || r.stderr || '').slice(0, 300))
  process.exit(1)
}

const steps = [
  ['批注进得去', got.annotateOk && got.noteAdded],
  ['批注不改正文', got.textKeptAfterAnnotate],
  ['压可信度生效', got.doubtOk && got.confidenceDropped],
  ['压可信度不改正文', got.textKeptAfterDoubt],
  ['钉时间生效', got.dateOk && got.timePinned],
  ['钉时间不改正文', got.textKeptAfterDate],
  ['条数不变', got.countStable],
]
for (const [name, ok] of steps) console.log(`${ok ? '过' : '挂'}  ${name}`)
const allOk = steps.every(([, ok]) => ok)
console.log(allOk ? '三种改法都能改，且一个字没擦。' : '不对：有一步没生效，或者把原话改了。')
process.exit(allOk ? 0 : 1)
