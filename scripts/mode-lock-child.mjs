/** 子进程：自模式里记 N 次「想过」。用法：node mode-lock-child.mjs <home> <n> */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const [home, n] = process.argv.slice(2)
// 2026-11-21：不给家目录也照样跑。实测那时家目录会被算成字符串「undefined」，
// 于是在当前目录里凭空造一个叫 undefined 的文件夹，往里头记五次「想过」——
// 假数据落盘、退出码零。缺参就停。
if (!home) {
  console.log('用法：node mode-lock-child.mjs <家目录> <条数>')
  console.log('缺家目录：不给它，家目录会被算成「undefined」，当场在工作目录里造一个假的家。')
  process.exit(2)
}
process.env.USERPROFILE = home
process.env.HOME = home

// 2026-11-21：按当前目录拼库，换目录跑就断（实测在别的目录里跑，模块找不到、退出码一）。
const S = await import('file:///' + join(HERE, '..', 'lib', 'selfmode.js').replace(/\\/g, '/'))
for (let i = 0; i < Number(n || 5); i++) S.noteThink(10, true, Date.now() + i)
process.exit(0)
