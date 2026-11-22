/** 子进程：往绑定表里绑 N 个窗口。用法：node bind-lock-child.mjs <home> <tag> <n> */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const [home, tag, n] = process.argv.slice(2)
// 2026-11-21：参数缺一个也照样往下绑，窗口名会写成「undefined-0」——垃圾进表、退出码还是零。
// 跟念头池那份子进程同一个病根，这里一并堵。
if (!home || !tag) {
  console.log('用法：node bind-lock-child.mjs <家目录> <标签> <条数>')
  console.log('缺的是：' + (!home ? '家目录' : '标签') + '（缺了会绑出一串名字是 undefined 的窗口）')
  process.exit(2)
}
process.env.USERPROFILE = home
process.env.HOME = home

// 2026-11-21：按当前目录拼库，换目录跑就断（跟念头池那份一样，从 C 盘根目录跑必挂）。
const S = await import('file:///' + join(HERE, '..', 'lib', 'session.js').replace(/\\/g, '/'))
for (let i = 0; i < Number(n || 5); i++) S.bindSession('main', `${tag}-${i}`)
process.exit(0)
