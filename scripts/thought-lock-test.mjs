import { NODE as _nodeBin } from './_node-bin.mjs'
/**
 * 念头池并发测试：两个进程各写八条，看最后是不是十六条
 * ====================================================
 *   node scripts/thought-lock-test.mjs
 *
 * 以前没有锁：后写的那个拿着旧快照，把前一个刚写的盖掉，条数会少。
 * 退出码 0 = 一条没丢，1 = 丢了。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const childFile = join(HERE, 'thought-lock-child.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'thought-lock-'))
mkdirSync(join(tmp, '.dsh'), { recursive: true })
const pool = join(tmp, '.dsh', 'selfmind.json')

function run(tag) {
  return new Promise((resolve) => {
    const p = spawn(_nodeBin, [childFile, tmp, tag, '8'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: tmp, HOME: tmp } })
    p.on('exit', (code) => resolve(code))
  })
}

const codes = await Promise.all([run('A'), run('B')])
let n = 0
try {
  const j = JSON.parse(readFileSync(pool, 'utf8'))
  n = (j.thoughts || []).length
} catch {}
console.log(`两个进程各写 8 条，池子里实际 ${n} 条（退出码 ${codes.join(',')}）`)
const ok = n === 16
console.log(ok ? '一条没丢' : '丢了 ' + (16 - n) + ' 条——锁没起作用')
if (existsSync(join(tmp, '.dsh'))) rmSync(tmp, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
