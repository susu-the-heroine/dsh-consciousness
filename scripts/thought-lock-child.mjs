/** 子进程：往念头池里连写 N 条。用法：node thought-lock-child.mjs <home> <tag> <n> */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const [home, tag, n] = process.argv.slice(2)
// 2026-11-21：参数缺一个，它照样往下写，标签就变成「undefined」——八条垃圾进了池子，
// 退出码还是零。缺参就停，说清楚缺哪个。
if (!home || !tag) {
  console.log('用法：node thought-lock-child.mjs <家目录> <标签> <条数>')
  console.log('缺的是：' + (!home ? '家目录' : '标签') + '（一个都不许缺，缺了会写出标签是 undefined 的垃圾）')
  process.exit(2)
}
process.env.USERPROFILE = home
process.env.HOME = home
process.env.DSH_SELFMIND_FILE = join(home, '.dsh', 'selfmind.json')

// 2026-11-21：按当前目录拼库，从别的目录跑就断（实测从 C 盘根目录跑，模块找不到、退出码一）。
const S = await import('file:///' + join(HERE, '..', 'lib', 'selfmind.js').replace(/\\/g, '/'))
for (let i = 0; i < Number(n || 8); i++) {
  S.addThought({ text: `${tag} 的第 ${i} 条`, origin: 'assoc' }, Date.now() + i * 10)
}
process.exit(0)
