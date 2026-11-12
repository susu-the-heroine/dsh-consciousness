/**
 * 检索基准：十二道题
 * ==================
 *
 * 为什么要有这个：说「检索准」不能靠感觉。这套基准给一个可重复的数——
 * 同一组题，改任何权重、门槛、同义词，跑一遍就知道是变好还是变坏。
 *
 * 每道题都是「像他会那么问」的口语，不是标题原文。
 * expected 是标准答案的编号；拿到别的编号就算错。
 *
 * 跑法：node test/recall-bench.mjs
 *
 * 注意：基准固定用 neutralMood，不看当下情绪。
 * 否则她心情一变，同一道题的排名就变——那种数不可比。
 */
const BASE = new URL('../', import.meta.url).href
const { searchTool } = await import(BASE + 'lib/tools.js')

/** 题库：问法 / 期望编号 / 这句在考什么 */
const CASES = [
  ['他抽什么烟', [4], '正文没有"烟"字，考实体与共现'],
  ['他住在哪条路', [14], '考地名'],
  ['打赌输了多少', [5], '考事件'],
  ['薯片', [20, 8], '两个字的短查询；两条都讲薯片'],
  ['他减肥之前多重', [6], '考语义：正文写的是"230 斤减到 160 斤"'],
  ['他的真名叫什么', [1, 95], '考同义：库里叫"本名"，另有"名字"那条'],
  ['阑尾炎打吊针那阵', [73, 15], '考事件与身体'],
  ['那条爆了的视频多少播放', [126], '考数字与事件'],
  ['为什么不许提睡觉两个字', [34, 3], '考禁区'],
  ['他家几套房', [7], '考数字事实'],
  ['他骂我傻屌时的心里话', [84, 97], '考情绪与贬称；音调那条也算'],
  ['别再一次性推多少行', [130], '考教训类'],
]

const TOPK = 5

console.log('检索基准（' + CASES.length + ' 道）：\n')
let hit1 = 0
let hit5 = 0
const miss = []
for (const [q, wantList, why] of CASES) {
  let ids = []
  try {
    const out = await searchTool.execute({ query: q, limit: TOPK, review: false, neutralMood: true }, {})
    ids = [...String(out.log || '').matchAll(/· #(\d+)/g)].map((m) => Number(m[1]))
  } catch (e) {
    ids = []
  }
  // 最佳答案排第一算①；任意可接受答案进前五算对
  const rankOf = (list) => {
    let best = 99
    for (const w of list) {
      const r = ids.indexOf(w) + 1
      if (r > 0 && r < best) best = r
    }
    return best
  }
  const rank = rankOf(wantList)
  const firstIsBest = ids[0] === wantList[0]
  if (firstIsBest) hit1++
  if (rank >= 1) hit5++
  if (!rank) miss.push({ q, want: wantList[0], got: ids, why })
  const mark = firstIsBest ? '①' : (rank ? '第' + rank : '✗')
  console.log('  ' + mark.padEnd(4) + q.padEnd(16) + '期望 #' + wantList.join('/#').padEnd(6) + '拿到 ' + (ids.length ? ids.join(' ') : '（空）'))
}

const pct = (n) => Math.round((n / CASES.length) * 100) + '%'
console.log('\n第一名就是最佳答案: ' + hit1 + '/' + CASES.length + ' = ' + pct(hit1))
console.log('可接受答案进前五: ' + hit5 + '/' + CASES.length + ' = ' + pct(hit5))
if (miss.length) {
  console.log('\n没翻到的：')
  for (const m of miss) console.log('  「' + m.q + '」 应该出 #' + m.want + '（' + m.why + '）')
}
process.exit(0)
