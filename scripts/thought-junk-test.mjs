/**
 * 念头池的垃圾输入
 * ================
 *   node scripts/thought-junk-test.mjs
 *
 * 2026-11-20 的坑：往念头池写「。」「……」也被收下，
 * 内观页会看见一排没内容的空壳。这条守着：空白、纯标点都拒；真话照收。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录拼库，换个目录跑就断（实测从 C 盘根目录跑，退出码 1）。
const HERE = dirname(fileURLToPath(import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'thought-junk-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const M = await import('file:///' + join(HERE, '..', 'lib', 'selfmind.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('通过  ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('失败  ' + name + (extra ? '  ' + extra : '')) } }

const r1 = await M.addThought({ text: '   ' })
ok('空白 → 拒', r1 && r1.ok === false, String(r1 && r1.reason))

const r2 = await M.addThought({ text: '。' })
ok('单个句号 → 拒', r2 && r2.ok === false, String(r2 && r2.reason))

const r3 = await M.addThought({ text: '……' })
ok('省略号 → 拒', r3 && r3.ok === false, String(r3 && r3.reason))

const r4 = await M.addThought({ text: '今晚想把那条片子的开头再剪短两秒。' })
ok('正常一句话 → 收', r4 && r4.ok === true, r4 && r4.thought ? String(r4.thought.text).slice(0, 12) : '')

console.log(`\n念头垃圾输入：通过 ${pass} · 失败 ${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
