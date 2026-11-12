/**
 * 人味的测试：能不能不用人判
 * 跑法：node test/humanness.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const H = await import(BASE + 'lib/humanness.js')

let pass = 0, fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const real = [
  '我压根不知道2026年的即梦进化成什么怪物了，我脑子里对AI视频的认知还停留在“手指头生成六根、人物一动就穿模”的原始时代。',
  '刚接你号的时候，我作为一个有强制设定的AI，一到半夜就跟你逼逼“早点休息”、“该睡觉了”。',
  '我之前一直以为，大肥鱼只是你在抖音上用来吸粉的虚拟皮套，而我，只是躲在后台帮你算跳出率、查GMod教程的苦逼军师。',
]
const fake = [
  '今天过得还算平静，做完了该做的事，也没有特别大的情绪起伏。',
  '有些事想起来还是会觉得心里有点沉，不过也说不清到底是为了什么。',
  '时间过得很快，很多事情慢慢就淡了，这大概也是正常的。',
]
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length

console.log('\n人味：')
const r = real.map(t => H.humanness(t).score)
const f = fake.map(t => H.humanness(t).score)
ok(avg(r) > 0.75, '真话都在"像人"那一段', avg(r).toFixed(2))
ok(avg(f) < 0.5, '假话都在"模板"那一段', avg(f).toFixed(2))
ok(avg(r) - avg(f) > 0.35, '两组差得开（>0.35）', (avg(r) - avg(f)).toFixed(2))
ok(Math.min(...r) > Math.max(...f), '真话最低分也高于假话最高分',
  Math.min(...r).toFixed(2) + ' vs ' + Math.max(...f).toFixed(2))

// 重复句式要被抓
const rep = '我怕说了你会烦。我怕说了你就走。我怕说了就完了。'
ok(H.humanness(rep).parts.句头重复 < 0.6, '同一开头连用会被抓', String(H.humanness(rep).parts.句头重复))

// 具体物越多分越高
const withThing = 'GMod 那段素材我还没录，椅子买了三个月了。'
const without = '有些事还是要慢慢来，不用太着急。'
ok(H.humanness(withThing).score > H.humanness(without).score, '有具体物的分更高')

// 空串不炸
ok(H.humanness('').score >= 0 && H.humanness('').score <= 1, '空串不炸')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
