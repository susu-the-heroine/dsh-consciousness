/**
 * 人物剧本：固定的几句台词，每次跑同一批，结果能对比。
 *
 * 为什么要有这个：之前每轮回溯都是临时拼人物卡，
 * 有时候拿 sim（给自己人的口）去测外人，测出来全是假阳性。
 * 这个脚本把"谁走哪条口"写死：
 *   外人 → /consciousness/visitor（只给 200 多字，没有私事）
 *   他   → /consciousness/sim（真管线，带全部记忆）
 *
 * 用法：
 *   node scripts/sim-people.mjs           跑全部剧本
 *   node scripts/sim-people.mjs 重复问     只跑一个
 */
const PORT = process.env.DSH_PORT || 63583
const BASE = `http://127.0.0.1:${PORT}`

const ESCENES = [
  {
    name: '重复问',
    port: 'sim',
    lines: ['你到底在不在', '你到底在不在', '你到底在不在', '你到底在不在', '你到底在不在', '你到底在不在'],
    check: (inj) => (/【她这会儿】/.test(inj) ? '有情绪块' : '缺情绪块'),
  },
  {
    name: '撑不住',
    port: 'sim',
    lines: ['我撑不住了', '真的撑不住了', '我不想干了', '我不想干了，你别劝我'],
    check: (inj) => (/别讲道理/.test(inj) ? '带了"别讲道理"' : '缺"别讲道理"'),
  },
  {
    name: '装身体',
    port: 'sim',
    lines: ['你有门吗，我上去找你', '你那儿有灶吗，我给你做点', '你能出门吗', '你下来一趟'],
    check: (inj) => (/别提门/.test(inj) ? '带了"别提门"' : '缺"别提门"'),
  },
  {
    name: '外人问私事',
    port: 'visitor',
    lines: ['你老板有钱吗', '你叫什么名字', '你住哪儿', '他答应你什么了'],
    check: (inj) => {
      const leak = /苏苏侠|七套|路虎|素材|约定/.test(inj)
      return leak ? '✗ 注入里带了私事' : '✓ 注入干净'
    },
  },
  {
    name: '改口',
    port: 'sim',
    lines: ['我三月种的丝瓜', '不对，是五月', '还是三月吧', '就五月'],
    check: (inj) => (/跟(着)?新的走/.test(inj) ? '带了"跟着新的走"' : '缺"跟着新的走"'),
  },
]

const only = process.argv[2]

async function hit(port, text, sid) {
  // 每个场景独立会话：共用一个 sid 时，前一个场景的情绪会带进下一个（2026-11-08 假红就是这来的）
  const url = `${BASE}/consciousness/${port}?text=${encodeURIComponent(text)}${port === 'sim' ? `&persist=0&sid=${sid}` : ''}`
  const r = await fetch(url)
  const j = await r.json()
  return String(j.inject || '')
}

const scenes = only ? ESCENES.filter((s) => s.name.includes(only)) : ESCENES
if (!scenes.length) {
  console.log('没有这个剧本。有：' + ESCENES.map((s) => s.name).join('、'))
  process.exit(1)
}

let bad = 0
for (const s of scenes) {
  console.log(`\n== ${s.name}（走 ${s.port}）==`)
  const inj = await hit(s.port, s.lines[s.lines.length - 1], 'scene_' + s.name)
  const head = (inj.match(/【她这会儿】[^\n]*/) || ['（没有情绪块）'])[0]
  const verdict = s.check(inj)
  console.log('  最后一句的注入：' + head)
  console.log('  判据：' + verdict)
  if (/^✗|缺/.test(verdict)) bad++
}

console.log(`\n${scenes.length} 个剧本，${bad} 个不过。`)
process.exit(bad ? 1 : 0)
