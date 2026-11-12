/**
 * 整库向量重算（本地推理版）
 * ==========================
 *
 * 换了引擎就得整库重算：查询向量和库里向量必须在同一个空间，混着用就是错。
 *
 *   node scripts/rebuild-vectors.mjs [sea] [--apply]
 *
 * 不加 --apply 只报"会重算几条"。真写之前先备份 vectors.json。
 */
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const apply = process.argv.includes('--apply')

const V = await import('file:///' + join(HERE, '..', 'lib', 'vectors.js').replace(/\\/g, '/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE, '..', 'lib', 'embed-onnx.js').replace(/\\/g, '/') + '?v=' + Date.now())

const dir = join(homedir(), '.dsh', 'consciousness-seas', sea)
const dataFile = join(dir, 'data.json')
const vecFile = join(dir, 'vectors.json')
if (!existsSync(dataFile)) { console.log('没有这个海：' + sea); process.exit(1) }
const data = JSON.parse(readFileSync(dataFile, 'utf8').replace(/^\uFEFF/, ''))
const points = (data.points || []).filter((p) => !p.dead && !p.archived)

console.log(`海 ${sea}：要算 ${points.length} 条`)
if (!apply) {
  console.log('干跑，没写。加 --apply 才真算真写。')
  process.exit(0)
}

const t0 = Date.now()
const out = {}
let done = 0
for (const p of points) {
  const text = V.embedTextOf(p)
  if (!text.trim()) continue
  const v = await E.embedLocal(text)
  // 短文本那一路：标题+别名。短问句跟短标题更可比（2026-11-12 实测十道能进前十）
  const st = V.shortTextOf(p)
  const sv = st.trim() ? await E.embedLocal(st) : null
  out[String(p.id)] = {
    fp: Number(p.born) || 0,
    h: V.textHash(text),
    at: Date.now(),
    m: 'onnx-local',      // 标记来源：本地量化模型。换引擎时靠它认出来
    v,
    ...(sv ? { sv } : {}),
  }
  done++
  if (done % 40 === 0) console.log(`  ${done}/${points.length} …`)
}
console.log(`算完 ${done} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)

// 备份旧文件，再原子替换
if (existsSync(vecFile)) {
  const bak = vecFile + '.bak-' + Date.now()
  copyFileSync(vecFile, bak)
  console.log('旧向量已备份：' + bak.split('\\').pop())
}
const tmp = vecFile + '.tmp'
writeFileSync(tmp, JSON.stringify(out), 'utf8')
renameSync(tmp, vecFile)
const size = readFileSync(vecFile).length
console.log(`写好 ${Object.keys(out).length} 条 · ${(size / 1048576).toFixed(1)} MB`)
