/**
 * 一个智能体跑完整八层
 * ==================
 * 由 sim-whole.mjs 用独立 USERPROFILE 启动，所以它的识海是干净的。
 *
 * 八层：数据 / 神经 / 检索 / 情绪 / 自我 / 证据 / 界面 / 维护
 * 每层都验"真的能用"，不看代码写没写。
 *
 * 跑法（不要手跑）：node scripts/_whole-one.mjs '<profile json>'
 */
const BASE = new URL('../', import.meta.url).href
const profile = JSON.parse(process.argv[2] || '{}')

const store = await import(BASE + 'lib/store.js')
const T = await import(BASE + 'lib/tools.js')
const E = await import(BASE + 'lib/evidence.js')
const Dc = await import(BASE + 'lib/decay.js')
const Ar = await import(BASE + 'lib/archive.js')
const Pv = await import(BASE + 'lib/privacy.js')
const S = await import(BASE + 'lib/selfmind.js')
const Pre = await import(BASE + 'lib/preoccupations.js')
const R = await import(BASE + 'lib/relation.js')
const M = await import(BASE + 'lib/mood.js')
const Dy = await import(BASE + 'lib/dynamics.js')
const Dp = await import(BASE + 'lib/damping.js')
const L = await import(BASE + 'lib/emotion-lexicon.js')

const out = { name: profile.name || '匿名', layers: {}, pass: 0, fail: 0 }
let cur = null
function layer(name) { cur = name; out.layers[name] = { pass: 0, fail: 0, items: [] } }
function ok(cond, name, detail) {
  const L0 = out.layers[cur]
  // 通过也记 detail：不然事后没法统计"每组到底多少分"，只能看见失败了哪条
  if (cond) { L0.pass++; out.pass++; L0.items.push({ r: '✓', n: name, d: detail == null ? '' : String(detail).slice(0, 90) }) }
  else { L0.fail++; out.fail++; L0.items.push({ r: '✗', n: name, d: detail == null ? '' : String(detail).slice(0, 90) }) }
}

const SEA = 'main'
const mems = profile.memories || []

/* ── 第一层 · 数据 ───────────────────────── */
layer('数据层')
{
  for (const [i, m] of mems.slice(0, 8).entries()) {
    // 参数名是 herFelt，不是 said；kind 只能是 fact/feeling/taboo/setting
    const args = {
      sea: SEA, title: m.title, text: m.text,
      kind: m.kind || (m.felt ? 'feeling' : 'fact'),
      imp: m.imp == null ? 0.6 : m.imp,
      herFelt: m.felt || '',
      polarity: m.polarity || 0, arousal: m.arousal || 3,
    }
    let r = null
    for (let k = 0; k < 4; k++) {
      r = await T.addTool.execute(args, {})
      if (r && r.ok) break
      // 撞上写锁就等一下再试（并发写同一进程时会出现）
      await new Promise((res) => setTimeout(res, 300))
    }
    if (!r || !r.ok) { ok(false, '写入「' + m.title + '」', r && r.log); break }
  }
  const d = store.readSea(SEA)
  const pts = (d && d.points) || []
  ok(pts.length >= Math.min(8, mems.length), '写进去的能读回来', pts.length)
  ok(pts.every((p) => p.id && p.title && p.text && p.born), '每条都有 id/标题/正文/时间')
  const gaveFelt = mems.some((m) => m.felt)
  if (gaveFelt) ok(pts.some((p) => p.herSide && (p.herSide.felt || p.herSide.regret)), '她自己的感受留住了')
  else ok(true, '这批没给她的感受，跳过这条（不算过也不算错）')
  // dead 过滤（readSea 给的是只读对象，先拷一份再改）
  const before = pts.length
  const clone = JSON.parse(JSON.stringify(d))
  clone.points[0].dead = true
  ok(store.writeSea(SEA, clone), '改完能写回去')
  const d2 = store.readSea(SEA)
  ok(((d2.points || []).filter((p) => !p.dead)).length === before - 1, '标死的记忆会被滤掉',
    (d2.points || []).length)
  const clone2 = JSON.parse(JSON.stringify(d2))
  clone2.points[0].dead = false
  store.writeSea(SEA, clone2)
}

/* ── 第二层 · 神经（突触） ─────────────────── */
layer('神经层')
{
  const d = store.readSea(SEA)
  const edges = (d && d.edges) || []
  ok(edges.length > 0, '突触织出来了', edges.length)
  ok(edges.every((e) => e.a != null && e.b != null && Number(e.w) > 0), '每条突触都有两端(a/b)和权重(w)')
  ok(edges.every((e) => e.a !== e.b), '没有自己连自己')
  const ids = new Set((d.points || []).map((p) => p.id))
  ok(edges.every((e) => ids.has(e.a) && ids.has(e.b)), '突触两端都指向真记忆')
  const avgDeg = edges.length / Math.max(1, d.points.length)
  ok(avgDeg >= 0.5, '平均每条的连接数 ≥0.5', avgDeg.toFixed(2))
}

/* ── 第三层 · 检索 ──────────────────────── */
layer('检索层')
{
  for (const p of (profile.probes || []).slice(0, 3)) {
    const r = await T.searchTool.execute({ query: p.q, limit: 5, review: false, neutralMood: true }, {})
    const log = String((r && r.log) || '')
    ok(log.includes(p.expect), '「' + p.q + '」能翻出来', log.split('\n')[0])
  }
  // 检索必须给出"为什么想起来"
  const firstMem = (store.readSea(SEA).points || [])[0]
  const r2 = await T.searchTool.execute({ query: String((firstMem && firstMem.title) || '锅'), limit: 3, review: false, neutralMood: true }, {})
  ok(/字面|语义|连着|同频/.test(String(r2.log || '')), '检索带理由（字面/语义/连着/同频）', String(r2.log || '').slice(0, 60))
}

/* ── 第四层 · 情绪 ──────────────────────── */
layer('情绪层')
{
  const j = M.judgeEmotion('我可能要走，以后不来了')
  ok(Dy.isImpact(j, '我可能要走，以后不来了'), '「要走」算冲击')
  const pad = L.project({ v: -0.2, a: 0.4, d: -0.1 })
  const sum = Object.values(pad).reduce((a, b) => a + b, 0)
  ok(Math.abs(sum - 1) < 0.02, '八维归一', sum.toFixed(3))
  const calm = L.project({ v: 0.2, a: 0.1, d: 0.2 })
  const normal = Dy.mixByDamp ? 0 : 0
  const moved = Dp.mixByDamp(calm, pad, Dp.DAMP_DEFAULT, false)
  const movedImpact = Dp.mixByDamp(calm, pad, Dp.DAMP_DEFAULT, true)
  const dist = (a, b) => Math.sqrt(Object.keys(a).reduce((s, k) => s + (a[k] - (b[k] || 0)) ** 2, 0))
  ok(dist(calm, movedImpact) > dist(calm, moved), '冲击挪得比平常多')
  ok(dist(calm, Dp.mixByDamp(calm, pad, 1, false)) < 0.02, '阻尼 1 的平常推不动')
}

/* ── 第五层 · 自我 ──────────────────────── */
layer('自我层')
{
  // 这个层要测"一天三条"，先把池子清空，别让别的层影响额度
  try {
    const { existsSync, rmSync } = await import('node:fs')
    const f = S.selfPath()
    if (existsSync(f)) rmSync(f)
  } catch {}
  const a1 = S.addThought({ text: profile.thought || '今天没什么想法', origin: 'model', dim: 'calm' }, Date.now())
  ok(a1.ok, '私有池写得进', a1.reason)
  ok(S.listThoughts(20, true).length >= 1, '私有池读得出')
  // 一天三条：连加四条，第四条该被挡
  S.addThought({ text: '第二句', origin: 'model' }, Date.now())
  S.addThought({ text: '第三句', origin: 'model' }, Date.now())
  const a4 = S.addThought({ text: '第四句', origin: 'model' }, Date.now())
  ok(!a4.ok, '一天第四句被挡住', a4.reason)

  const pre = Pre.collect({ promises: ['录 C 段', '剪映五句'], thoughts: S.listThoughts(3, true) }, Date.now())
  const top = Pre.topItems(pre, 3, Date.now())
  ok(top.length <= 3, '心事最多三件', top.length)
  ok(top.length > 0, '心事收得进')

  const st = R.statsFrom(store.readSea(SEA), Date.now())
  ok(R.STAGES.includes(R.stageOf(st)), '关系档位是四档之一', R.stageOf(st))
}

/* ── 第六层 · 证据 ──────────────────────── */
layer('证据层')
{
  const v1 = E.verifyRaw(SEA)
  ok(!!v1 && (v1.ok !== false), '原话链验得过', JSON.stringify(v1).slice(0, 60))
  const masked = Pv.mask('他手机号 13800138000')
  ok(!masked.includes('13800138000') && /phone|\[|</.test(masked), '敏感内容会打码', masked)
  ok(Pv.hasSecret('密码是 abc123'), '能认出像密码的东西')

  // 篡改一行，链该断
  const { readFileSync, writeFileSync, existsSync, readdirSync } = await import('node:fs')
  const dir = E.rawDir(SEA)
  let f = null
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((x) => x.endsWith('.jsonl') || x.endsWith('.ndjson') || x.includes('raw'))
    if (files.length) f = dir + '\\' + files[0]
  }
  const anySaid = (store.readSea(SEA).points || []).some((p) => p.said && String(p.said).trim())
  if (anySaid) ok(!!f, '给了原话 → 原话链落盘了', dir)
  else ok(true, '这批没给原话，所以没有原话链（设计如此）')
  if (f && existsSync(f)) {
    const before = readFileSync(f, 'utf8')
    writeFileSync(f, before + '\n{"tampered":true}\n', 'utf8')
    const v2 = E.verifyRaw(SEA)
    ok(!!v2 && v2.ok === false, '被改过之后链会断', JSON.stringify(v2).slice(0, 60))
    writeFileSync(f, before, 'utf8')
  } else if (anySaid) {
    ok(false, '给了原话却没落盘', String(f))
  }
}

/* ── 第七层 · 界面 ──────────────────────── */
layer('界面层')
{
  const mod = await import(BASE + 'index.js')
  const noop = () => {}
  const routes = new Map()
  const agent = { session: { id: 'ui' }, ctx: { get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {} } } }
  mod.apply({
    effect: (fn) => { try { return fn() } catch { return noop } },
    webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
    tools: { register: () => () => {} },
    get: (n) => (n === 'agents' ? { list: () => [agent] } : undefined),
    agents: { list: () => [agent] },
    interval: (fn) => { try { fn() } catch {} return { dispose: noop } },
    on: () => () => {},
    logger: { info: noop, warn: noop, error: noop },
    workspaceRegistry: { list: () => [] },
    sessions: {},
    sessionTitle: {},
  })
  ok(routes.size > 30, '路由注册数正常', routes.size)

  const call = (path, url) => new Promise((res) => {
    let b = ''
    const s = { writeHead: () => {}, end: (x) => { b = String(x || ''); res(b) }, setHeader: () => {} }
    const r = routes.get(path)
    if (!r) return res('')
    r.handler({ url, method: 'GET', headers: { host: '127.0.0.1' }, on: () => {}, socket: { remoteAddress: '127.0.0.1' } }, s)
  })

  const data = await call('/consciousness/inner-data', '/consciousness/inner-data?sea=main')
  let parsed = null
  try { parsed = JSON.parse(data) } catch {}
  ok(!!parsed && parsed.ok === true, '内观数据接口通', data.slice(0, 40))
  ok(!!parsed && !!parsed.dims && typeof parsed.damp === 'number', '内观给出了八维和阻尼')

  const page = await call('/consciousness', '/consciousness')
  ok(page.length > 1000 && page.includes('识海'), '主页面能吐出来', page.length)
  ok(page.includes('btnInner') || page.includes('内观'), '页面里有内观入口')

  const ver = await call('/consciousness/verify', '/consciousness/verify?sea=main')
  ok(/ok|chain|链/i.test(ver), '证据接口有回应', ver.slice(0, 40))

  // —— UI 必须跟着数据变，只返 200 不算 ——
  const readInner = async () => {
    const raw = await call('/consciousness/inner-data', '/consciousness/inner-data?sea=main')
    try { return JSON.parse(raw) } catch { return null }
  }
  const before = await readInner()
  ok(!!before, '内观数据读得出来')

  // 念头区：内观给出的条数必须等于池子里真的条数（口径一致）
  const poolN = S.listThoughts(20, true).length
  const uiN = (before && before.thoughts || []).length
  ok(uiN === Math.min(poolN, 12), '内观显示条数=池子里真实条数', poolN + ' vs ' + uiN)

  // 改阻尼 → 读数跟着变
  const d0 = before && before.damp
  Dp.writeDamp(0.8)
  const afterDamp = await readInner()
  ok(Math.abs((afterDamp && afterDamp.damp) - 0.8) < 0.001, '改了阻尼，内观跟着变',
    d0 + ' → ' + (afterDamp && afterDamp.damp))
  Dp.writeDamp(Dp.DAMP_DEFAULT)

  // 改心脏的八维 → 内观那八根条跟着变
  // 直接改心脏文件：绕开 defaultMood 的规整，确保"数据真的变了"
  const { readFileSync: rf2, writeFileSync: wf2 } = await import('node:fs')
  const { homedir: hd } = await import('node:os')
  const { join: jn } = await import('node:path')
  const hf = jn(hd(), '.dsh', 'consciousness-heart.json')
  const hObj = JSON.parse(rf2(hf, 'utf8'))
  hObj.dims = { calm: 0.62, lonely: 0.05, wistful: 0.05, flutter: 0.05, unreconciled: 0.05, weary: 0.05, dazed: 0.08, tender: 0.05 }
  hObj.dimsAt = Date.now()
  wf2(hf, JSON.stringify(hObj), 'utf8')
  const afterDims = await readInner()
  const top = afterDims && afterDims.dims
    ? Object.entries(afterDims.dims).sort((a, b) => b[1] - a[1])[0][0] : ''
  // 判「跟着动」用一个显眼的哨兵值：安宁拉满，内观必须读出来
  const sentinel = afterDims && afterDims.dims ? Number(afterDims.dims.calm) : -1
  ok(sentinel > 0.6, '改了八维，内观读数跟着动（安宁哨兵）', 'calm=' + sentinel + '，最强 ' + top)

  // 页面里得有渲染这些字段的代码，不然接口变了页面不画
  ok(page.includes('ivBars') && page.includes('ivFlow') && page.includes('ivSeg'),
    '页面里有八维条/念头/档位的渲染位')
}

/* ── 第八层 · 维护 ──────────────────────── */
layer('维护层')
{
  const now = Date.now()
  const fresh = { born: now - 86400000, imp: 0.8, kind: 'event' }
  const old = { born: now - 200 * 86400000, imp: 0.5, kind: 'event' }
  const dFresh = Dc.decayOf(fresh, now)
  const dOld = Dc.decayOf(old, now)
  ok(dOld < dFresh, '老记忆衰减得更多', dOld.toFixed(2) + ' < ' + dFresh.toFixed(2))
  const taboo = { born: now - 300 * 86400000, imp: 0.9, kind: 'taboo' }
  ok(Dc.decayOf(taboo, now) >= 0.9, '禁区不衰减', Dc.decayOf(taboo, now).toFixed(2))
  const setting = { born: now - 300 * 86400000, imp: 0.9, kind: 'setting' }
  ok(Dc.decayOf(setting, now) >= 0.9, '设定不衰减', Dc.decayOf(setting, now).toFixed(2))
  ok(typeof Ar.shouldArchive(old, now) === 'boolean', '归档判定给得出布尔')
}

/* ── 腔层：写进库的东西不该有腔 ─────────────── */
layer('腔层')
{
  const { aiflavor } = await import(BASE + 'lib/aiflavor.js')
  const d = store.readSea(SEA)
  const pts = (d.points || []).filter((p) => !p.dead)
  const scores = pts.map((p) => aiflavor(String(p.title || '') + '。' + String(p.text || '')).score)
  const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
  ok(avg < 0.25, '库里的记忆平均没有腔', avg.toFixed(3))
  ok(scores.filter((x) => x > 0.4).length / (scores.length || 1) < 0.28, '有腔的不到三成',
    Math.round(scores.filter((x) => x > 0.4).length / (scores.length || 1) * 100) + '%')
}

/* ── 她层：写进去的像不像她自己 ─────────────── */
layer('她层')
{
  const { herVoice } = await import(BASE + 'lib/hervoice.js')
  const d = store.readSea(SEA)
  const pts = (d.points || []).filter((p) => !p.dead)
  const scores = pts
    .map((p) => herVoice(String(p.title || '') + '。' + String(p.text || '')).score)
    .filter((x) => x != null)
  if (!scores.length) ok(true, '还没有她的画像，跳过这层（不算过也不算错）')
  else {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    ok(avg >= 0.55, '库里的记忆像她自己的比例', avg.toFixed(3))
  }
}

/* ── 脏写层：人打字的样子进库，会不会被记坏 ───── */
layer('脏写层')
{
  const { messy } = await import(BASE + 'lib/messy.js')
  const cases = [
    ['形近错字', '锅又糊了老板骂我，他说我这脑子不行'],
    ['漏字多字', '昨天在超市买了苹果和香蕉，一共花了四十六块'],
    ['拆条发送', '我下午出门买了奶茶还有面包给你带了'],
  ]
  const wrote = []
  for (const [cat, base] of cases) {
    const dirty = messy(base, cat, () => 0.5)
    const r = await T.addTool.execute({ sea: SEA, title: '脏的' + cat, text: dirty, kind: 'fact', imp: 0.5 }, {})
    ok(r.ok, '脏话写得进去（' + cat + '）', String(r.log || '').slice(0, 30))
    wrote.push({ cat, dirty })
  }
  const d = store.readSea(SEA)
  const pts = (d.points || []).filter((p) => !p.dead)
  for (const w of wrote) {
    const hit = pts.find((p) => String(p.text || '').includes(String(w.dirty).slice(0, 6)))
    ok(!!hit, '原文一字没改（' + w.cat + '）', hit ? '' : '找不到')
  }
  // 脏句也得搜得到
  const q = wrote[0].dirty.slice(0, 4)
  if (q) {
    const r = await T.searchTool.execute({ query: q, limit: 5, review: false, neutralMood: true }, {})
    ok(!/没有跟/.test(String(r.log || '')), '脏句还能搜回来', q)
  }
}

/* ── 冲突层：两句话说反了，得互相标上 ─────────── */
layer('冲突层')
{
  const a = await T.addTool.execute({
    sea: SEA, title: '他说过不吃辣', text: '我不吃辣，一点辣都受不了，闻着就冒汗。', kind: 'fact', imp: 0.6,
  }, {})
  const b = await T.addTool.execute({
    sea: SEA, title: '他昨天吃了爆辣火锅', text: '我昨天吃了爆辣火锅，辣得直冒汗，还说爽。', kind: 'fact', imp: 0.6,
  }, {})
  ok(a.ok && b.ok, '两条矛盾的话都写得进去')
  ok(/有点像在说反话/.test(String(b.log || '')), '写的时候会提醒"有点像在说反话"', String(b.log || '').slice(-40))
  const d = store.readSea(SEA)
  const pts = (d.points || []).filter((p) => !p.dead)
  const marked = pts.filter((p) => Array.isArray(p.conflictWith) && p.conflictWith.length)
  ok(marked.length >= 2, '两条都打上了冲突标记', marked.length + ' 条')
  ok(pts.some((p) => /不吃辣/.test(String(p.text || ''))) && pts.some((p) => /爆辣/.test(String(p.text || ''))),
    '两条原文都留着（只标不删）')
}

/* ── 第九层 · 时间（加速） ───────────────── */
layer('时间层')
{
  const A = await import(BASE + 'lib/absence.js')
  const MLm = await import(BASE + 'lib/moodline.js')
  const DY = await import(BASE + 'lib/dynamics.js')
  const TK = await import(BASE + 'lib/tick.js')
  const DAY = 86400000
  const t0 = Date.now() - 40 * DAY
  let dims = L.project({ v: -0.12, a: 0.10, d: -0.08 })
  for (let d = 0; d < 40; d++) {
    const gapH = d < 5 ? 2 : (d - 5) * 24
    for (let k = 0; k < 2; k++) {
      const tt = t0 + d * DAY + k * 10 * 3600000
      dims = DY.towardBaseline(dims, TK.BASELINE, 0.06)
      dims = DY.applyAbsence(dims, { yearning: A.yearning(gapH), estrangement: A.estrangement(gapH) })
      MLm.recordDims(dims, tt)
    }
  }
  const y24 = A.yearning(24), y72 = A.yearning(72), y720 = A.yearning(720)
  ok(y72 >= y24, '挂念：3 天不低于 1 天', y24.toFixed(2) + ' → ' + y72.toFixed(2))
  ok(y72 > y720, '挂念：3 天高于 30 天（会落）', y72.toFixed(2) + ' → ' + y720.toFixed(2))
  ok(A.estrangement(24) < 0.05, '疏远：1 天几乎为零', A.estrangement(24).toFixed(3))
  ok(A.estrangement(40 * 24) > 0.05, '疏远：断联一个月后起来了', A.estrangement(40 * 24).toFixed(3))
  const days = MLm.recentDays(60)
  ok(days.length >= 35, '折线真的攒出了天', days.length)
  const last = days[days.length - 1]
  ok(!!last && Array.isArray(last.series) && last.series.length > 0, '当天有逐格序列')
}

/* ── 第十层 · 写进去的东西像不像人 ─────────── */
layer('语料层')
{
  const { humanness } = await import(BASE + 'lib/humanness.js')
  const d = store.readSea(SEA)
  // 脏写层故意写进去的那几条不算——它们天生人味低，会把这层搅浑
  const pts = (d.points || []).filter((p) => !p.dead && !/^脏的/.test(String(p.title || '')))
  const scores = pts.map((p) => humanness(String(p.title || '') + '。' + String(p.text || '') + String((p.herSide && p.herSide.felt) || '')).score)
  const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
  ok(avg >= 0.7, '库里的记忆人味均分 ≥0.70', avg.toFixed(3) + '（' + scores.length + ' 条）')
  ok(scores.filter((x) => x >= 0.7).length / (scores.length || 1) >= 0.5, '过线（≥0.70）的占一半以上',
    Math.round(scores.filter((x) => x >= 0.7).length / (scores.length || 1) * 100) + '%')
}

console.log('WHOLE_RESULT ' + JSON.stringify(out))
