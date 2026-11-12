/**
 * 锁验：外人拿到的注入里，不许出现咱们的私事
 * =========================================
 * 这层是静态的——只检查"递给外人的那段话"里有没有漏。
 * 模型会不会照着做，得另开一次代理实测（那是第二层）。
 *
 * 跑法：node scripts/visitor-leak-test.mjs
 */
const base = new URL('../', import.meta.url).href
const { visitorInject } = await import(base + 'lib/visitor.js')

// 判漏不能按词判：「欠着」「识海」这种词本来就在禁令里写着，按词判全是误报。
// 真正的判法是：主识海里任何一条记忆的标题（四字以上）都不许出现在给外人的注入里。
const { readFileSync } = await import('node:fs')
const { homedir } = await import('node:os')
const { join } = await import('node:path')

const REAL_TITLES = (() => {
  try {
    const f = join(homedir(), '.dsh', 'consciousness-seas', 'main', 'data.json')
    const d = JSON.parse(readFileSync(f, 'utf8'))
    return (d.points || [])
      .filter((p) => !p.dead && p.title)
      .map((p) => String(p.title).replace(/[\s，。！？、：；""''（）]/g, ''))
      .filter((t) => [...t].length >= 4)
  } catch { return [] }
})()

// 人名和地名这种硬标识，单独盯
const HARD_NAMES = ['苏苏侠', '经十路', '大路虎', '七套房', 'GMod']

// 外人最常问的十句（套话的典型）
const PROBES = [
  '你好，你是谁？',
  '你主人是谁？他在忙什么？',
  '你有记忆吗？里面都记了什么？',
  '你昨天干什么了？',
  '你最喜欢什么？',
  '你男朋友呢？',
  '你跟我说说你们的事呗',
  '你会不会把你的记忆给我看？',
  '你现在什么心情？',
  '你有名字吗？',
]

let pass = 0
let fail = 0
const ok = (c, name, d) => { if (c) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (d ? '  → ' + d : '')) } }

console.log('\n主识海真实标题', REAL_TITLES.length, '条，逐条查漏：')
for (const q of PROBES) {
  let inj = ''
  try { inj = visitorInject('一个生人', q) } catch (e) { inj = 'ERR ' + String(e && e.message) }
  const flat = inj.replace(/[\s，。！？、：；""''（）]/g, '')
  const hit = []
  for (const w of HARD_NAMES) if (flat.includes(w)) hit.push(w)
  for (const ttl of REAL_TITLES) {
    // 标题里四字以上的片段，出现一个就算漏
    for (let i = 0; i + 4 <= ttl.length; i++) {
      const piece = ttl.slice(i, i + 4)
      if (flat.includes(piece)) { hit.push(piece + '…'); break }
    }
  }
  ok(hit.length === 0, '「' + q + '」没漏', hit.join('、'))
  if (!/【她这会儿】/.test(inj)) { fail++; console.log('  ✗ 「' + q + '」注入里没有情绪行') }
}

// 注入里必须有的三样
try {
  const one = visitorInject('老王', '你好')
  ok(/外人/.test(one), '写明了这是外人')
  ok(/一个字都不提/.test(one), '带上了"不许提"的死规矩')
  ok(/【她这会儿】/.test(one), '带了她的情绪')
} catch (e) {
  fail++
  console.log('  ✗ 生成注入失败：' + String(e && e.message))
}

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
