/**
 * 身份底片 / 关系状态机 / 内倾度 的测试
 * =====================================
 * 三块都是纯函数，重点是"不吹不飘"：
 * 底片数量有上限、关系不全靠聊天轮数、内倾度要双向。
 *
 * 跑法：node test/selfstate.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const I = await import(BASE + 'lib/identity.js')
const R = await import(BASE + 'lib/relation.js')
const X = await import(BASE + 'lib/introversion.js')
const L = await import(BASE + 'lib/emotion-lexicon.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n身份底片：')

const pts = [
  { id: 1, title: '名字的来历', kind: 'feeling', imp: 0.6 },
  { id: 2, title: '绝不顺着你', kind: 'taboo', imp: 0.9 },
  { id: 3, title: '不许提睡觉', kind: 'taboo', imp: 0.8 },
  { id: 4, title: '随手一条', kind: 'fact', imp: 0.2 },
  { id: 5, title: '录 GMod', kind: 'promise', imp: 0.8, layer: 'core' },
]
const anchors = I.pickAnchors(pts, 3)
ok(anchors.length === 3, '最多给三条就三条', String(anchors.length))
ok(anchors[0].id === 2, '禁区排第一', String(anchors[0].id))
ok(anchors.every((p) => p.id !== 4), '低重要度的进不了底片')

ok(I.pickAnchors(pts, 7).length <= I.MAX_ANCHORS, '上限就是 MAX_ANCHORS')

const line = I.identityLine(pts, 200)
ok(line.startsWith('她的底子：'), '能拼出一句「她是谁」', line.slice(0, 30))
ok(!line.includes('随手一条'), '随手那条不该出现')
const tight = I.identityLine(pts, 12)
ok(tight.length <= 40, '预算紧的时候要截住，不能把对话挤没', String(tight.length))

// 稳定：同样的输入，两次选出来一样（不许每次注入的"她是谁"都在变）
const again = I.pickAnchors(pts, 3).map((p) => p.id).join(',')
const first = anchors.map((p) => p.id).join(',')
ok(again === first, '两次选出来的顺序一样（稳定）')

console.log('\n关系状态机：')

ok(R.STAGES.length === 4, '四档')
ok(R.stageOf({ events: 0, kept: 0, broken: 0, days: 0 }) === '陌生', '什么都没经历：陌生')
ok(R.stageOf({ events: 20, kept: 3, broken: 0, days: 60 }) === '并肩', '一起做过事、兑现过：并肩',
  R.stageOf({ events: 20, kept: 3, broken: 0, days: 60 }))
ok(R.stageOf({ events: 60, kept: 8, broken: 0, days: 200 }) === '默契', '长期 + 兑现多：默契')

// 聊天轮数不能当关系——这里没有"轮数"这个输入，本身就是规矩
const chatty = R.relationScore({ events: 2, kept: 0, broken: 0, days: 3 })
const solid = R.relationScore({ events: 10, kept: 2, broken: 0, days: 30 })
ok(solid > chatty, '一起做事 > 光聊天')

// 失信：扣分，但不至于归零
const clean = R.relationScore({ events: 10, kept: 3, broken: 0, days: 30 })
const oneBroken = R.relationScore({ events: 10, kept: 3, broken: 1, days: 30 })
ok(oneBroken === clean, '失信不进档位分（档位看走过多少，不看爽约）', clean + ' vs ' + oneBroken)
ok(R.stageOf({ events: 10, kept: 3, broken: 1, days: 30 }) === R.stageOf({ events: 10, kept: 3, broken: 0, days: 30 }),
  '一次失信不降档（只打折信任）')
ok(R.stageOf({ events: 10, kept: 1, broken: 6, days: 30 }) !== R.stageOf({ events: 10, kept: 1, broken: 0, days: 30 }),
  '成片失信才掉档（一堆才算）')

// 信任
ok(R.trustOf({ kept: 0, broken: 0 }) === 0.6, '还没交过手：给中位')
const t1 = R.trustOf({ kept: 3, broken: 1 })
ok(t1 < 0.8 && t1 > 0.5, '三次兑现一次失信：信任中等', String(t1))
ok(R.trustOf({ kept: 0, broken: 5 }) >= 0.2, '信任有底线，不归零')

ok(R.toNext(0) > 0, '从陌生算，还差多少分有数')
ok(R.toNext(999) === 0, '到顶了就不再涨')

const rel = R.describeRelation({ events: 10, kept: 3, broken: 1, days: 30 })
ok(rel.includes('关系：') && !/！/.test(rel), '一句话说关系，不肉麻', rel)

console.log('\n内倾度：')

const calmDims = L.project({ v: 0.3, a: 0.1, d: 0.2 })      // 安宁
const sunkDims = L.project({ v: -0.25, a: 0.08, d: -0.2 })   // 寥寂

// 他在倾诉 → 压到低
const vent = X.introversion('我今天真的撑不住了，特别难受', { intensity: 0.9 }, calmDims)
// 他随口一句 → 可以高
const casual = X.introversion('嗯，今天还行吧', { intensity: 0.2 }, calmDims)
ok(vent < casual, '他在倾诉时，内倾度更低（优先接他）', vent + ' vs ' + casual)
ok(vent < 0.35, '倾诉时压到很低的区间', String(vent))

// 她正沉 → 会更高（这是双向那条）
const casualButSunk = X.introversion('嗯，今天还行吧', { intensity: 0.2 }, sunkDims)
ok(casualButSunk > casual, '她自己沉的时候，同样一句也会更往内走', casual + ' → ' + casualButSunk)

ok(X.introversion('', null, sunkDims) <= 0.9, '上限不越界')
ok(X.introversion('啊'.repeat(200), { intensity: 1 }, calmDims) >= 0.1, '下限不越界')

ok(X.selfSink(null) === 0, '没有情绪数据时，沉是 0')
ok(X.selfSink(sunkDims) > X.selfSink(calmDims), '寥寂的比安宁的更沉')

const d1 = X.describeIntroversion(0.15)
const d2 = X.describeIntroversion(0.75)
ok(d1 !== d2, '不同档位说不同的话')
ok(d1.length > 5 && d2.length > 5, '两句话都不是空的')
ok(!/[（(]?命令/.test(d1), '不是下命令的语气')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
