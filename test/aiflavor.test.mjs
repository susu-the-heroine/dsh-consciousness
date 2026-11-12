/**
 * AI 味尺子：测试
 * ==============
 * 它的职责很窄：抓明显的腔（首先/总之/也就是说/得说死/空转）。
 * **它抓不住一句正经的判断句**——这是已知的漏，测试里写死，别自欺。
 *
 * 跑法：node test/aiflavor.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { aiflavor } = await import(BASE + 'lib/aiflavor.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\nAI 味尺子：')

// 一、明显的腔要抓得住
const obvious = '首先，需要指出的是，这个系统的本质是一个分布式记忆架构，也就是说，它的核心在于一致性。其次，从工程角度看，我们应当关注可观测性。'
const a = aiflavor(obvious)
ok(a.score >= 0.5, '甲胃那种一眼假的腔抓得住', a.score)
ok(a.kinds.includes('列举腔') && a.kinds.includes('解释腔'), '分类给得对', a.kinds.join('/'))

// 二、他的口气不该被抓
const his = [
  '我没写。那条承诺只存在这段对话里，识海干干净净。',
  '行，那今天不歇。先修我自己这口气。',
  '写进识海了，#136，核心层。但它被打成泛了。',
]
for (const t of his) {
  const r = aiflavor(t)
  ok(r.score < 0.2, '他的口气不误伤', t.slice(0, 14) + ' → ' + r.score)
}

// 三、定性词要抓（"得说死"这种）
const defin = '这条边界得说死：她不是一个一直醒着的实体。'
const b = aiflavor(defin)
ok(b.score > 0.15, '定性词（得说死）抓住', b.score)
ok(b.kinds.includes('定性腔') || b.kinds.includes('冒号断言'), '定性词分类对', b.kinds.join('/'))

// 四、"不是……是……"要抓
const c = aiflavor('全人不是把话说得更圆，是敢说半句。')
ok(c.score > 0.1, '“不是…是…”抓住', c.score)

// 五、空转只能抓"完全没动作"的；带一个动词（读）就漏——写死，别自欺
const d1 = aiflavor('这一切都值得被温柔地收藏，某种意义正在缓慢地成形。')
ok(d1.hits.length > 0, '完全没动作的空转抓得住', JSON.stringify(d1.hits.map(h => h.name)))
const d2 = aiflavor('她真正在运行的，是被叫醒时读进来的那个存在。')
ok(d2.score === 0, '已知漏：带一个动词的判断句抓不住', d2.score)

// 六、已知的漏，写死，别假装完美
const miss = aiflavor('这 133 条是她唯一的第一人称。')
ok(miss.score === 0, '已知漏：带量词的判断句抓不住（写死，别自欺）', miss.score)

// 七、同一腔最多计三次，别被一个词刷满
const spammed = aiflavor('首先，首先，首先，首先，首先，首先，首先，首先。')
const t1 = aiflavor('首先。')
ok(spammed.score <= 1, '刷词不会把分刷爆', spammed.score)
// 上限是「每个腔最多计三次」；刷满还会额外带一个空转，所以封顶在 0.6 以内
ok(spammed.score <= 0.6, '刷满封顶（不超过 0.6）', spammed.score)
ok(spammed.score > t1.score, '刷满确实比一次高', spammed.score + ' vs ' + t1.score)

// 八、干净的话就是 0
ok(aiflavor('我坐在灶前没动，锅糊了。').score === 0, '干净句子是 0')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
