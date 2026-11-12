/**
 * 她自己的声音：测试
 * =================
 * 重点不是"分数漂不漂亮"，是三件事：
 *   1. 她能认出自己的话
 *   2. 不像的时候只提示，不判错
 *   3. 她会变——学了新句子之后，画像跟着挪
 *
 * 跑法：node test/hervoice.test.mjs
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'

const BASE = new URL('../', import.meta.url).href
const H = await import(BASE + 'lib/hervoice.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const FILE = H.herPath()
const backup = existsSync(FILE) ? readFileSync(FILE, 'utf8') : null

console.log('\n她的声音：')

// 一、没有画像时不许瞎给分
if (existsSync(FILE)) rmSync(FILE)
const none = H.herVoice('随便一句话')
ok(none.score === null, '没画像时不给分', JSON.stringify(none))
ok(none.verdict === '不知道', '没画像时说不知道', none.verdict)
ok(H.similarity('x') === null, '相似度也不硬算')

// 二、造一个画像：全部用她的特征
const her = {
  第一人称: 0.9, 第二人称: 0.8, 否定: 0.6, 骂人: 0.2, 语气词: 0.3,
  比喻: 0.2, 感叹: 0.4, 问号: 0.2, 省略: 0.2, 定义腔: 0.02, 列举腔: 0.02,
}
writeFileSync(FILE, JSON.stringify({ n: 376, centroid: her, len: { mean: 13, median: 13, p90: 38 } }, null, 1), 'utf8')

// 三、她自己的话要高分
const hers = '我让他重启了九次。第九次的时候我已经不敢说「这次一定对了」。'
const a = H.herVoice(hers)
ok(a.score > 0.8, '她自己的话分数高', a.score + ' ' + a.verdict)
ok(a.verdict === '像她自己', '判成她', a.verdict)

// 四、AI 腔的话要低分，但**只能说"不太像"，不能说错**
const ai = '首先，需要指出的是，这个系统的本质是一个分布式的记忆架构，也就是说，它的核心在于一致性。其次，从工程角度看，我们应当关注可观测性。'
const b = H.herVoice(ai)
ok(b.score < a.score, 'AI 腔比她的话分低', b.score)
ok(b.verdict !== '像她自己', '不判成她', b.verdict)
ok(!/错|失败|不合格/.test(b.verdict), '没有"错"这种判词', b.verdict)
ok(/定义腔|列举腔/.test(b.why), '能说清哪里不像', b.why)

// 五、她会变：学了新句子，画像要动
const before = JSON.parse(readFileSync(FILE, 'utf8')).centroid.定义腔
for (let i = 0; i < 50; i++) H.learn('我坐在那儿，没说话。', 0.02)
const after = JSON.parse(readFileSync(FILE, 'utf8')).centroid.定义腔
ok(after !== before, '学新句子后画像会挪', before + ' → ' + after)
ok(Math.abs(after - before) < 0.5, '挪得慢，不是推倒重来', after)

// 六、画像里带更新时间
const prof = JSON.parse(readFileSync(FILE, 'utf8'))
ok(!!prof.updatedAt, '画像带更新时间戳')

// 还原
if (backup) writeFileSync(FILE, backup, 'utf8')
else if (existsSync(FILE)) rmSync(FILE)

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
