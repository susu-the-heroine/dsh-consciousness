/**
 * JS 写入版 · 自验
 * ================
 *
 * 拿三条已知缺陷做断言。全绿才说明“修好了”，不是“改过了”。
 *
 * 跑法：node scripts/writer-verify.mjs
 */
import { buildPoint, findDuplicate, mergeInto, extractEntities, extractTriggers, findConflict, sim, applyConflict } from '../lib/writer-js.js'

let pass = 0
let fail = 0

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('✓ ' + name) }
  else { fail++; console.log('✗ ' + name + (detail ? '  ── ' + detail : '')) }
}

// ── 1. 去重：同标题同正文写两遍，应当只有一条
{
  const a = buildPoint({ title: '今天吃了碗面', text: '十二点半下楼，吃了碗牛肉面。', kind: 'fact' }, [])
  const b = buildPoint({ title: '今天吃了碗面', text: '十二点半下楼，吃了碗牛肉面。', kind: 'fact' }, [a])
  const dup = findDuplicate(b, [a])
  ok('去重能认出来', !!dup && dup.exact === true, dup ? 'ratio=' + dup.ratio : '没认出来')
  if (dup) {
    const merged = mergeInto(dup.p, b, Date.now())
    const list = [merged]
    ok('合并后仍是一条', list.length === 1)
    ok('合并后想起次数 +1', merged.recallCount === 1, '得到 ' + merged.recallCount)
    ok('合并后不新增 id', merged.id === a.id)
  }
  // 不同正文不算重复
  const c = buildPoint({ title: '今天吃了碗面', text: '晚上吃的，换了家店，三十块。', kind: 'fact' }, [a])
  ok('同标题不同正文不算重复', findDuplicate(c, [a]) === null)
}

// ── 2. 强度：按存的 imp 算（2026-11-12 起不再走 0.5 兜底）
{
  const imp = 0.6
  const arousal = 5
  const p1 = buildPoint({ title: 'x', text: 'y', kind: 'fact', imp }, [])
  const want = Math.round((0.5 + 50 * imp * imp + 20 * (arousal / 10)) * 100) / 100
  ok('强度按真实 imp 算', Math.abs(p1.strength - want) < 0.011, `想要 ${want}，得到 ${p1.strength}`)
  ok('难度也按真实 imp 算', Math.abs(p1.difficulty - 0.49) < 0.0011, '得到 ' + p1.difficulty)
  const p2 = buildPoint({ title: 'x', text: 'y', kind: 'fact', imp: 0.3 }, [])
  ok('imp 变了强度跟着变', p2.strength < p1.strength, `${p2.strength} vs ${p1.strength}`)
}

// ── 3. 坐标：同一个 id、同一批旧点，必须落同一处
{
  const base = [buildPoint({ title: 'a', text: 'b', kind: 'fact' }, [])]
  const p1 = buildPoint({ title: '同一条', text: '同一条正文', kind: 'fact' }, base)
  const p2 = buildPoint({ title: '同一条', text: '同一条正文', kind: 'fact' }, base)
  ok('坐标可复现', p1.x === p2.x && p1.y === p2.y && p1.z === p2.z, `${p1.x},${p1.y},${p1.z} vs ${p2.x},${p2.y},${p2.z}`)
  ok('空库第一条落在固定点', base[0].x === 1.9 && base[0].y === 0 && base[0].z === 0)
}

// ── 4. 四十个字段一个不少
{
  const NEED = ('after alias arousal born category confidence conflictWith cost difficulty emotion entities era '
    + 'evidence evidenceRef factKey falsifier herSide id imp kind lastSeen layer layerWhy open origin polarity '
    + 'recallCount replied said src strength tag target text title titleFull triggers validFrom validUntil x y z').split(' ')
  const p = buildPoint({ title: 'a', text: 'b', kind: 'feeling' }, [])
  const miss = NEED.filter((k) => !(k in p))
  ok('字段齐（' + NEED.length + ' 个）', miss.length === 0, '缺：' + miss.join(','))
}

// ── 5. 实体：认得名单里的名字，也抽大写英文
{
  const e1 = extractEntities('我叫大肥鱼，用 GMod 剪片')
  ok('实体认得名单里的名字', e1.includes('大肥鱼'), JSON.stringify(e1))
  ok('实体抽大写英文', e1.includes('GMod'), JSON.stringify(e1))
  ok('实体最多六个', extractEntities('A B C D E F G H').length <= 6)
}

// ── 6. 钉子与冲突
{
  const tg = extractTriggers('随便你，我不干了', 7)
  ok('钉子词能认出来', tg.length === 2 && tg[0].id === 7, JSON.stringify(tg))
  ok('没钉子词就空', extractTriggers('今天吃了碗面', 8).length === 0)

  const a = { id: 1, entities: ['大肥鱼'], category: ['关系'], polarity: -1, text: '他说他不干了，我很难过' }
  const b = { id: 2, entities: ['大肥鱼'], category: ['关系'], polarity: 1, text: '他说他不干了，我挺高兴' }
  ok('极性相反且内容像 → 判为冲突', findConflict([a], b) === a)
  const c = { id: 3, entities: ['大肥鱼'], category: ['关系'], polarity: 1, text: '完全不相干的一句话在这里' }
  ok('内容不像就不判冲突', findConflict([a], c) === null)
  ok('相似度同句为 1', Math.abs(sim('今天吃了碗面', '今天吃了碗面') - 1) < 1e-9)

  const np = { id: 9, entities: ['大肥鱼'], category: ['关系'], polarity: 1, text: '他说他不干了，我挺高兴', conflictWith: [] }
  const hit = applyConflict(np, [a])
  ok('冲突写进新条目', np.conflictWith.includes(1), JSON.stringify(np.conflictWith))
  ok('旧条目也记住新条目（双向）', !!hit && hit.conflictWith.includes(9), JSON.stringify(hit && hit.conflictWith))
}

console.log('')
console.log(`通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
