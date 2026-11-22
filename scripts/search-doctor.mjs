/**
 * 检索不灵的时候，先跑这个
 * ========================
 *
 *   node scripts/search-doctor.mjs            # 看主库
 *   node scripts/search-doctor.mjs 工作        # 看指定海
 *
 * 只看不写。输出五段：条数、向量、索引、调参、最近一次检索。
 * 最后给一句判词：卡在哪一段。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] || 'main'
const SEAS = join(homedir(), '.dsh', 'consciousness-seas')
const dir = join(SEAS, sea)

const out = []
const say = (s) => out.push(s)

if (!existsSync(join(dir, 'data.json'))) {
  console.log(`没有这个海：${sea}`)
  const have = existsSync(SEAS) ? null : null
  console.log(`海目录：${SEAS}${have === null ? '' : ''}`)
  process.exit(1)
}

// 1) 条数
let d = { points: [] }
try { d = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8').replace(/^\uFEFF/, '')) } catch {}
const all = Array.isArray(d.points) ? d.points : []
const alive = all.filter((p) => !p.dead)
say(`一、条数：总共 ${all.length} 条，在用 ${all.filter((p) => !p.dead && !p.archived).length} 条，归档 ${all.filter((p) => !p.dead && p.archived).length} 条`)

// 1.5) 归档：归档不进检索，只能 restore。这里点一下数量，别让人以为"记丢了"
const archived = all.filter((p) => !p.dead && p.archived)
if (archived.length) {
  say(`   另有 ${archived.length} 条已归档（按设计不进检索，要翻就用 memory_archive restore）：`)
  for (const p of archived.slice(0, 5)) say(`   · #${p.id} ${String(p.title || '').slice(0, 26)}`)
  if (archived.length > 5) say(`   · …还有 ${archived.length - 5} 条`)
}

// 2) 向量
let vecN = 0
let vecRaw = {}
try {
  const vf = join(dir, 'vectors.json')
  if (existsSync(vf)) {
    const raw = JSON.parse(readFileSync(vf, 'utf8'))
    vecRaw = raw || {}
    vecN = Object.keys(vecRaw).length
  }
} catch {}
const inUse = all.filter((p) => !p.dead && !p.archived)
const cover = inUse.length ? Math.round((vecN / inUse.length) * 100) : 0
say(`二、向量：${vecN} 条有向量，覆盖 ${cover}%（按在用的 ${inUse.length} 条算；缺了只能靠字面搜）`)
// 缺向量的点，实测连原句都搜不到——这不是"覆盖 99% 无所谓"，有几条就列几条
const noVec = inUse.filter((p) => !vecRaw[String(p.id)])
if (noVec.length) {
  say(`   缺向量的 ${noVec.length} 条（这几条大概率搜不到）：`)
  for (const p of noVec.slice(0, 12)) say(`   · #${p.id} ${String(p.title || '').slice(0, 28)}`)
  if (noVec.length > 12) say(`   · …还有 ${noVec.length - 12} 条`)
}

// 3) 索引
let ftsN = null
try {
  const db = join(dir, 'memory.db')
  if (existsSync(db) && process.versions.node) {
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const { DatabaseSync } = require('node:sqlite')
    const h = new DatabaseSync(db, { readOnly: true })
    const r = h.prepare('SELECT count(*) AS n FROM points_fts').get()
    ftsN = Number(r && r.n)
    h.close()
  }
} catch {}
const ftsGap = ftsN === null ? 0 : alive.length - ftsN
say(`三、索引：${ftsN === null ? '没有索引文件（第一次搜会慢，之后会建）' : ftsN + ' 条进了全文索引'}${ftsGap > Math.max(3, alive.length * 0.05) ? '；比库里少了 ' + ftsGap + ' 条（索引旧了）' : ''}`)

// 4) 调参
let tune = {}
try {
  const tp = join(homedir(), '.dsh', 'consciousness-tuning.json')
  if (existsSync(tp)) tune = JSON.parse(readFileSync(tp, 'utf8').replace(/^\uFEFF/, ''))
} catch {}
const keys = Object.keys(tune || {})
const minScore = Number(tune.minScore)
say(`四、调参：${keys.length ? keys.join(' / ') : '没改过（用默认）'}${Number.isFinite(minScore) && minScore > 0 ? '；门槛抬到 ' + minScore + '，分不够就不给看' : ''}`)

// 5) 最近一次检索
let last = ''
try {
  const lf = join(homedir(), '.dsh', 'consciousness-search-log.jsonl')
  if (existsSync(lf)) {
    const txt = readFileSync(lf, 'utf8')
    const lines = txt.split(/\r?\n/).filter(Boolean)
    last = lines.slice(-1)[0] || ''
  }
} catch {}
say(`五、最近一次检索：${last ? last.slice(0, 120) : '还没有记录（说明一次都没搜过，或日志被清）'}`)

console.log(out.join('\n'))
console.log('')

// 判词
const problems = []
if (!alive.length) problems.push('这个海是空的，先写一条再搜')
if (alive.length && cover < 50) problems.push('向量缺太多，只能靠字面——先跑 node scripts/embed-backfill.mjs')
if (ftsN === null && alive.length > 50) problems.push('全文索引还没建，第一次搜会慢')
if (ftsN !== null && alive.length - ftsN > Math.max(3, alive.length * 0.05)) problems.push('索引落后了 ' + (alive.length - ftsN) + ' 条，新写的那些靠字面搜不到——重建一次索引')
if (Number.isFinite(minScore) && minScore >= 8) problems.push('门槛设到 ' + minScore + ' 了，弱相关全被挡，看着像没记住')
if (!last) problems.push('没有任何检索记录，先确认你是不是在对话里问过')

if (problems.length) {
  console.log('判词：有问题，按顺序排——')
  for (const p of problems) console.log('  · ' + p)
} else {
  console.log('判词：这五段都正常。搜不到就换一种问法，或者问的确实没记过。')
}
