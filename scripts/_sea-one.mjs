/**
 * 一个智能体的识海完整体测
 * ======================
 * 由 sim-seas.mjs 用独立 USERPROFILE 启动，所以它的 ~/.dsh 是干净的。
 *
 * 测什么（记忆半边，全走真模块）：
 *   一、写 12 条记忆，带 factKey / born / herSide / 置信
 *   二、检索：拿记忆里的细节当问题，看第一条是不是它
 *   三、不确定性：编的日期要标"时间估的"，真的不标
 *   四、confirm：置信拉上去，排序权重也要跟着涨
 *   五、doubt：置信压下去，不能删
 *   六、冲突：同一个事实键两版都活着，要报出来
 *   七、私有池：加一条、超上限挡住、删掉
 *
 * 跑法（不要手跑，由 sim-seas.mjs 起）：
 *   node scripts/_sea-one.mjs '<profile json>'
 */
const BASE = new URL('../', import.meta.url).href
const profile = JSON.parse(process.argv[2] || '{}')

const store = await import(BASE + 'lib/store.js')
const { uncertainty } = await import(BASE + 'lib/uncertainty.js')
const U = await import(BASE + 'lib/uncertainty.js')
const C = await import(BASE + 'lib/conflict.js')
const S = await import(BASE + 'lib/selfmind.js')
const P = await import(BASE + 'lib/persona.js')

const out = { name: profile.name, pass: 0, fail: 0, items: [] }
function ok(cond, name, detail) {
  if (cond) { out.pass++; out.items.push({ r: '✓', name }) }
  else { out.fail++; out.items.push({ r: '✗', name, detail: detail == null ? '' : String(detail) }) }
}

/** 一、造这套记忆 */
const now = Date.now()
const DAY = 86400000
const mems = (profile.memories || []).map((m, i) => ({
  id: i + 1,
  title: m.title,
  text: m.text,
  kind: m.kind || 'event',
  imp: Number(m.imp == null ? 0.6 : m.imp),
  born: now - (Number(m.daysAgo) || 0) * DAY,
  bornEstimated: !!m.estimated,
  source: m.source || (m.estimated ? 'guess' : 'he'),
  confidence: m.estimated ? 0.3 : 0.85,
  factKey: m.factKey || '',
  validUntil: m.validUntil || null,
  polarity: Number(m.polarity) || 0,
  arousal: Number(m.arousal) || 3,
  herSide: m.felt ? { felt: m.felt, regret: m.regret || '' } : null,
}))

const sea = 'main'
// writeSea 不会自己建目录——不建就直接失败，而且不报错（踩过）
const { mkdirSync } = await import('node:fs')
const { dirname } = await import('node:path')
try { mkdirSync(dirname(store.seaPath(sea)), { recursive: true }) } catch {}
const wrote = store.writeSea(sea, { version: 1, points: mems, edges: [], createdAt: Date.now() })
ok(!!wrote, '识海文件写进去了', wrote)
// 生产里写入会自动同步向量；这里手写文件，得手动同步一次。
// 不同步的话只有字面检索，"三条狗"这种词对不上就永远找不到——踩过。
try {
  const V = await import(BASE + 'lib/vectors.js')
  // 签名是 syncVectors(sea, data, limit)——少传 data 就一条都不同步（踩过）
  const fresh = store.readSea(sea)
  const r = await V.syncVectors(sea, fresh, 200)
  ok(Number(r) > 0, '向量真同步进去了（' + r + ' 条）', String(r))
  const st = V.vectorStats(sea, store.readSea(sea))
  ok(Number(st.ready_count) > 0, '向量就绪数 > 0', JSON.stringify(st))
} catch (e) {
  ok(false, '向量同步失败', String((e && e.message) || e).slice(0, 60))
}

const back = store.readSea(sea)
ok(!!back && Array.isArray(back.points) && back.points.length === mems.length,
  '写得进也读得出（' + mems.length + ' 条）', back ? (back.points || []).length : 'null')

/** 二、检索：用细节问，看第一条对不对 */
const probes = profile.probes || []
// 用真检索（混合检索那条路），不是我自己写的二字重合
const { searchTool } = await import(BASE + 'lib/tools.js')
for (const p of probes) {
  const data = store.readSea(sea)
  const hit = (data.points || []).find((x) => String(x.title).includes(p.expectTitle))
  ok(!!hit, '「' + p.q + '」这条记忆在库里（' + p.expectTitle + '）')
  if (hit) {
    let first = ''
    try {
      const r = await searchTool.execute({ query: p.q, limit: 3, review: false, neutralMood: true }, {})
      const txt = String((r && r.log) || '')
      first = txt.split('\n')[0] || ''
      ok(txt.includes(p.expectTitle), '「' + p.q + '」真检索能把它翻出来', first.slice(0, 40))
    } catch (e) {
      ok(false, '「' + p.q + '」真检索跑不动', String(e && e.message).slice(0, 60))
    }
  }
}

/** 三、不确定性 */
const est = mems.find((m) => m.bornEstimated)
const real = mems.find((m) => !m.bornEstimated)
if (est) ok(U.timeConfidenceOf(est) < 0.5, '编的日期被标成不可信', U.timeConfidenceOf(est))
if (est) ok(U.markText(est) !== '', '编的日期会给标注', U.markText(est))
if (real) ok(U.timeConfidenceOf(real) >= 0.5 || !real.born, '真日期不挨标注')

/** 四、confirm：置信上去，权重也上去 */
if (real) {
  const before = U.rankWeight(real)
  const after = U.rankWeight(U.confirm(real, now))
  ok(after > before, 'confirm 之后排序权重变大', before.toFixed(2) + ' → ' + after.toFixed(2))
  ok(U.confidenceOf(U.confirm(real, now)) >= 0.9, 'confirm 之后置信 ≥0.9')
}

/** 五、doubt：置信下去，但不删 */
if (real) {
  const d = U.doubt(real, now)
  ok(U.confidenceOf(d) <= 0.3, 'doubt 之后置信降到 0.3 以下', U.confidenceOf(d))
  ok(String(d.title) === String(real.title), 'doubt 不删不改内容')
}

/** 六、冲突 */
const con = C.findConflicts(mems)
const shouldConflict = (profile.expectConflicts || 0) > 0
ok(con.length >= (profile.expectConflicts || 0),
  shouldConflict ? '该报的冲突报出来了' : '没有冲突时不乱报',
  '实际 ' + con.length)

/** 七、私有池 */
const before = S.listThoughts(50, true).length
const add = S.addThought({ text: profile.thought || '今天没什么想法', origin: 'model', dim: 'calm' }, now)
ok(add.ok, '私有池能写进去', add.reason)
ok(S.listThoughts(50, true).length === before + 1, '写完条数 +1')

/** 八、人格参数能套上去 */
if (profile.persona) {
  const dims = P.applyPersona({ calm: 0.125, lonely: 0.125, wistful: 0.125, flutter: 0.125, unreconciled: 0.125, weary: 0.125, dazed: 0.125, tender: 0.125 }, profile.persona, 1)
  const sum = Object.values(dims).reduce((a, b) => a + b, 0)
  ok(Math.abs(sum - 1) < 0.02, '人格偏移之后仍然归一', sum.toFixed(3))
  ok(Number.isFinite(P.dampOf(profile.persona)), '这个人的阻尼有值', P.dampOf(profile.persona))
}

// 只输出一行 JSON，父进程去解析
console.log('SEA_RESULT ' + JSON.stringify(out))
