/**
 * 四十条「人话问句」自测：不照题面，拿主海自己的条目造问法
 * ==========================================================
 *   node scripts/eval-human40.mjs
 *
 * 做法：随机抽 40 条主海记忆，按三种口语模板问回去——
 *   一、<标题>，是怎么回事
 *   二、还记得<标题>吗
 *   三、<标题>那个事，给我说说
 * 判据：头一条命中该条算「对上」；被拒答算「误拒」；答了别的算「答偏」。
 * 另加 10 条库裡根本没有的事，必须拒（拒答算对，硬答算「瞎答」）。
 * 只读主海，不写。
 */
process.env.C2_NO_REFUSAL_LOG = '1'
const S = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/lib/store.js')
const T = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/lib/tools.js')

const sea = 'main'
const pts = (S.readSea(sea).points || []).filter((p) => String(p.title || '').trim() && Number(p.id) !== 0)
// 固定抽样，可重复：按 id 排序后每隔 k 个取一条
pts.sort((a, b) => Number(a.id) - Number(b.id))
const step = Math.max(1, Math.floor(pts.length / 40))
const sample = []
for (let i = 0; i < pts.length && sample.length < 40; i += step) sample.push(pts[i])

const templates = [
  (t) => t + '，是怎么回事',
  (t) => '还记得' + t + '吗',
  (t) => t + '那个事，给我说说',
]

let hit = 0, refused = 0, other = 0
const misses = []
for (let i = 0; i < sample.length; i++) {
  const p = sample[i]
  const q = templates[i % templates.length](String(p.title).trim())
  const log = String((await T.searchTool.execute({ sea, query: q, limit: 3 }, {})).log || '')
  const firstId = (log.match(/#(\d+)/) || [])[1]
  if (String(firstId) === String(p.id)) hit++
  else if (/没记过|记糊了|没这|没写过/.test(log)) { refused++; misses.push('误拒｜' + q) }
  else { other++; misses.push('答偏｜' + q + ' → #' + (firstId || '?') + '（该 #' + p.id + '）') }
}

const negatives = [
  '那台磨豆机多少钱',
  '那双溜冰鞋是哪年买的',
  '他那个飞盘什么颜色',
  '皮划艇放在哪儿了',
  '望远镜什么牌子',
  '缝纫机还好使吗',
  '保温壶多大容量',
  '猫爬架哪买的',
  '折叠桌多少钱',
  '电风扇几档'
]
let denied = 0, hallucinated = 0
const badNeg = []
for (const q of negatives) {
  const log = String((await T.searchTool.execute({ sea, query: q, limit: 3 }, {})).log || '')
  if (/没记过|记糊了|没这|没写过/.test(log)) denied++
  else { hallucinated++; badNeg.push(q + ' → ' + log.replace(/\s+/g, ' ').slice(0, 40)) }
}

console.log('  正题 40 条：对上 ' + hit + ' · 误拒 ' + refused + ' · 答偏 ' + other)
console.log('  反题 10 条：老实拒 ' + denied + ' · 硬答 ' + hallucinated)
if (misses.length) {
  console.log('  没对上的（前十条）：')
  for (const m of misses.slice(0, 10)) console.log('    ' + m)
}
if (badNeg.length) {
  console.log('  硬答的（全列）：')
  for (const m of badNeg) console.log('    ' + m)
}
const ok = hit >= 34 && refused <= 2 && hallucinated === 0
console.log('  判定：' + (ok ? '过（对上 ≥34、误拒 ≤2、反题不硬答）' : '不过——看上面清单'))
process.exit(ok ? 0 : 1)
