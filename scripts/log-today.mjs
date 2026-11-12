/**
 * 往桌面档案《识海_今天做了什么.md》追加一行，带时间。
 *
 * 为什么要这个东西：以前每轮回溯都得等人提醒一句"别忘了更新档案"，
 * 然后就变成"想起来才写"。有了它，一条命令就能落，不再靠记性。
 *
 * 用法：
 *   node scripts/log-today.mjs "跑完一轮，两处红，改完复跑全绿"
 *   node scripts/log-today.mjs --title "2026-11-08 上午" "大段正文"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const FILE = join(homedir(), 'Desktop', '大肥鱼档案', '识海_今天做了什么.md')

const argv = process.argv.slice(2)
if (!argv.length) {
  console.log('用法：node scripts/log-today.mjs [--title 小标题] "要记的一句话"')
  process.exit(1)
}

let title = ''
if (argv[0] === '--title') {
  title = argv[1] || ''
  argv.splice(0, 2)
}
const body = argv.join(' ').trim()
if (!body) {
  console.log('没话可记。')
  process.exit(1)
}

const d = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

let text = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '# 识海 · 今天做了什么\n'
if (title) text = text.trimEnd() + `\n\n### ${title}（${stamp}）\n\n`
text = text.trimEnd() + '\n\n' + `- ${stamp}　${body}` + '\n'
writeFileSync(FILE, text, 'utf8')
console.log(`记了：${title ? title + ' · ' : ''}${stamp}　${body}`)
