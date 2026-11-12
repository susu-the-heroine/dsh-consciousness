/**
 * 给已有记忆补上「不确定性」三字段
 * ================================
 *
 * 只补不覆盖：已经有 confidence 的不动（那可能是人确认过的）。
 *
 * 分类规则写在 uncertainty.js 里，这里只负责跑一遍、报数、留证据。
 *
 * 跑法：node scripts/migrate-uncertainty.mjs [sea]
 */
const BASE = new URL('../', import.meta.url).href
const { readSea, writeSea } = await import(BASE + 'lib/store.js')
const U = await import(BASE + 'lib/uncertainty.js')

const sea = process.argv[2] || 'main'
const data = readSea(sea)
if (!data || !Array.isArray(data.points)) {
  console.log('读不到识海:', sea)
  process.exit(1)
}

const before = { he: 0, her: 0, guess: 0 }
const after = { he: 0, her: 0, guess: 0 }
let touched = 0

for (const p of data.points) {
  if (p.dead) continue
  const s0 = U.sourceOf(p)
  before[s0] = (before[s0] || 0) + 1

  const hadConfidence = Number.isFinite(Number(p.confidence))
  U.normalize(p, Date.now())
  if (!hadConfidence) touched++

  const s1 = U.sourceOf(p)
  after[s1] = (after[s1] || 0) + 1
}

const okWrite = writeSea(sea, data)
console.log('识海:', sea)
console.log('补了字段的条数:', touched, '/', data.points.filter((p) => !p.dead).length)
console.log('迁移前：他说的', before.he, '｜我写的', before.her, '｜我估的', before.guess)
console.log('迁移后：他说的', after.he, '｜我写的', after.her, '｜我估的', after.guess)
console.log('写盘:', okWrite ? '成功' : '失败')

// 抽查三条
for (const id of [1, 4, 14]) {
  const p = data.points.find((x) => Number(x.id) === id)
  if (!p) continue
  console.log('  #' + id, p.title.slice(0, 18),
    '| source=' + p.source,
    '| conf=' + Number(p.confidence).toFixed(2),
    '| 要标吗=' + (U.shouldMark(p) ? '是' : '否'))
}
