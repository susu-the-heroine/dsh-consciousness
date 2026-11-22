/**
 * 把别名候选写进库（默认只看不写）
 * ================================
 *
 * 安全设计（被今晚吓出来的）：
 *   一、默认 dry-run，只打印要改什么；加 --yes 才真写
 *   二、写之前整目录备份到 consciousness-backups/<sea>/alias-<时间>/
 *   三、只追加别名文字，不动标题、不动正文、不动任何已有字段
 *   四、一次最多写 20 条，超了先分两批
 *
 * 跑法：
 *   node scripts/apply-alias.mjs            # 看一眼会改什么
 *   node scripts/apply-alias.mjs --yes      # 真写（会先备份）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const candPath = join(homedir(), '.dsh', 'consciousness-alias-candidates.md')
const doIt = process.argv.includes('--yes')
const MAX = 20

if (!existsSync(candPath)) { console.log('没有候选文件：' + candPath); process.exit(0) }
const md = readFileSync(candPath, 'utf8')
if (md.includes('这次没学到东西')) { console.log('候选文件里写着"这次没学到东西"，不写库。'); process.exit(0) }

// 解析：# #12 标题 / - 建议别名：xxx
const items = []
let cur = null
for (const line of md.split('\n')) {
  const m1 = line.match(/^##\s+#(\d+)\s+(.*)$/)
  if (m1) { cur = { id: Number(m1[1]), title: m1[2].trim(), alias: '' }; items.push(cur); continue }
  const m2 = line.match(/^-\s*建议别名：(.+)$/)
  if (m2 && cur) cur.alias = m2[1].trim()
}
const use = items.filter((x) => x.id && x.alias).slice(0, MAX)
if (!use.length) { console.log('候选里没有可用的别名。'); process.exit(0) }

const sea = 'main'
const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const dataPath = join(dir, 'data.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))

const plan = []
for (const it of use) {
  const p = (data.points || []).find((x) => Number(x.id) === Number(it.id))
  if (!p) continue
  const old = String(p.alias || '')
  if (old.includes(it.alias)) continue
  plan.push({ p, old, add: it.alias })
}

console.log(`候选 ${items.length} 条 · 可写 ${plan.length} 条 · 海 ${sea}`)
for (const x of plan) {
  console.log(`  #${x.p.id} ${String(x.p.title || '').slice(0, 24)}`)
  console.log(`     旧：${x.old || '（无）'}`)
  console.log(`     加：${x.add}`)
}

if (!doIt) {
  console.log('')
  console.log('这是 dry-run。确认要写，加 --yes。')
  process.exit(0)
}

if (!plan.length) process.exit(0)

// 备份整目录，再写
const bkRoot = join(homedir(), '.dsh', 'consciousness-backups', sea)
mkdirSync(bkRoot, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const bkDir = join(bkRoot, 'alias-' + stamp)
mkdirSync(bkDir, { recursive: true })
for (const f of ['data.json', 'meta.json']) {
  const src = join(dir, f)
  if (existsSync(src)) copyFileSync(src, join(bkDir, f))
}
console.log('已备份到：' + bkDir)

for (const x of plan) {
  const old = String(x.p.alias || '').trim()
  const merged = old ? (old + ' / ' + x.add) : x.add
  x.p.alias = merged.slice(0, 200)
}
// 2026-11-21：原来是直接往 data.json 上写。写到一半断电或被杀，库就是半截 JSON ——
// 备份能救，可人未必知道该救。改成先写临时文件再改名，跟库里正经写入一个路子。
const tmpPath = dataPath + '.alias-tmp'
writeFileSync(tmpPath, JSON.stringify(data), 'utf8')
renameSync(tmpPath, dataPath)
console.log(`写入完成：${plan.length} 条别名。`)
