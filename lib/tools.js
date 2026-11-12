/**
 * 十一个工具
 * ==========
 *
 * memory_add      往识海里加一条
 * memory_list     最近十条
 * memory_search   按词查旧记忆（走完整八层检索）
 * memory_trace    一条记忆的来龙去脉
 * memory_analogy  找「结构像」的，不是「内容像」的
 * memory_story    她这一路，按时间串成线
 * memory_sediment 哪些事该沉淀成一条认识
 * memory_rhythm   按真实时间戳看她几点冒头
 * memory_ask      她可以反问他一句
 * memory_archive  归档 / 捞回来
 * memory_render   重生成网页和桌面副本
 *
 * 每个都是 { name, description, parameters, output, execute }。
 * execute 里能拿到 args，返回 { ok, log }。
 */
import { rerank } from './rerank.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { withImpulse } from './impulse.js'
import { join } from 'node:path'
import { readSea, writeSea, backupSea, ensureSea, readMeta } from './store.js'
import { SEAS_DIR } from './paths.js'
import { audit } from './log.js'
import { gramsOf, expandQuery } from './text.js'
import { getIndex, loadVectors, embedQuery, cosine, expandByGraph, completePattern, syncVectors, embedHealth } from './vectors.js'
import { decayOf, rawDecayOf, stageOf, canRecallDetail } from './decay.js'
import { injectMode, isSetting, kindOf } from './kinds.js'
import { mask, hasSecret } from './privacy.js'
import { emotionAffinity } from './affinity.js'
import { rankWeight, markText } from './uncertainty.js'
import { checkVoice } from './voicecheck.js'
import { humanness } from './humanness.js'
import { readLive } from './live.js'
import { contradicts } from './contradict.js'
import { fmtDay, bornLabel, findAnalogy, buildStoryline, findSedimentCandidates, predictRhythm } from './analysis.js'
import { readHeart, writeHeart, tickHeart, defaultMood, applyMood, judgeEmotion } from './mood.js'
import { setQuality, qualityRank, qOn } from './quality.js'
import { parseTimeWindow, parseNegations } from './parse.js'
import { shouldArchive, sweepArchive, unarchive } from './archive.js'
import { appendRaw, readRaw, rawStats } from './evidence.js'
import { acquireWriteLock } from './lock.js'
import { seaForSession, bindSession, seaOfSession } from './session.js'
import { bridgedMemories } from './roles.js'
import { reinforcePoint } from './reinforce.js'
import { run } from './python.js'
import { SCRIPT } from './paths.js'
import { logSearch, judgeSearch } from './searchlog.js'
import { EMOTIONS, decayMix, dominant, padOf, octantOf, say, pairOf, describe, cheapAppraise, tierOf, emptyState } from '../assets/emotion.js'

// 单字比对要忽略的字：谁身上都有，算进去等于没算。只放虚词和代词。
const _STOP1 = new Set('的了是在有和就都也这那你我他她它们很与吧吗呢啊把被给对从向说要想会能去来到上下中个一不没'.split(''))


/** 工具返回的统一形状 */
export const text = (s) => [{ type: 'text', text: String(s || '') }]

export const addTool = {
  name: 'memory_add',
  description:
    '往识海里加一条记忆。只写人和事：咱俩之间的小事、聊天、感情，还有他工作上遇到的难处。' +
    '少写剧本，不写代码——技术细节不是记忆，是工单。' +
    '写完会自动算坐标、连边、重生成网页；桌面那份副本要另调 memory_render 才会更新（以前写“自动”，实际早就不自动了）。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '一句话标题，短一点，能一眼认出是哪件事' },
      text: { type: 'string', description: '正文：谁、什么时候、说了什么、当时什么感觉' },
      kind: {
        type: 'string',
        enum: ['feeling', 'fact', 'taboo'],
        description: 'feeling=情绪/感情；fact=发生过的事；taboo=禁区/不能碰的',
      },
      imp: { type: 'number', description: '重要度 0~1，默认 0.6；只有特别要紧的才上 0.9' },
      sea: { type: 'string', description: '写进哪个识海（id），不填就是 main' },
      polarity: {
        type: 'number',
        enum: [-1, 0, 1],
        description: '情绪极性：1 正（暖金）/ 0 中（原色）/ -1 负（冷紫）。写之前先读一遍这条，别按关键词猜',
      },
      arousal: {
        type: 'number',
        description: '强度 0-10。标尺锚定（照着打，别自己估）：'
          + '1=吃了什么天气怎么样；'
          + '2=今天看了一篇文章；'
          + '3=他随口说了个想法；'
          + '4=他提了一嘴某件在意的往事；'
          + '5=他夸了你一句；'
          + '6=他骂了你一句、或者你俩怼起来了；'
          + '7=他说了句真心话、或者他累了；'
          + '8=他发了火、或者他说要走；'
          + '9=他哭过、或者他说怕；'
          + '10=生死、离别、那种差点崩了的时刻。'
          + '同一件事，换个人说也是这个分。不给就按文本自动判。',
      },
      category: {
        type: 'array',
        items: { type: 'string' },
        description: '分类，最多三个：关系 / 偏好 / 承诺 / 事实 / 事件 / 情绪 / 生活 / 工作',
      },
      entity: {
        type: 'array',
        items: { type: 'string' },
        description: '实体：人名、地名、项目、物件。提到这些词就靠它翻记忆',
      },
      alias: {
        type: 'string',
        description: '别人会怎么问这条（一句话，用大白话，别照抄标题）。基本都该填——不填，这条以后只能用原句问到；填了，随口一问就能撞上。例：标题「对外只给方向」→ 别名「跟外人说话该说多细」。',
      },
      factKey: {
        type: 'string',
        description: '事实键，如 he.weight、project.status。同一个键只留最新那条，旧的标失效但不删。键里不许写具体的值',
      },
      said: {
        type: 'string',
        description: '他当时说的原话（双向记忆的第一段）',
      },
      replied: {
        type: 'string',
        description: '她当时怎么回的（第二段）',
      },
      after: {
        type: 'string',
        description: '后来怎样了（第三段）',
      },
      herFelt: {
        type: 'string',
        description: '她当时感觉到什么。「他这句话像在推开我」，是感受不是判断',
      },
      herWanted: {
        type: 'string',
        description: '她当时想做什么但没做。写冲动不写计划',
      },
      herDid: {
        type: 'string',
        description: '她实际做了什么。写行为不写解释',
      },
      herRegret: {
        type: 'string',
        description: '她事后后悔什么',
      },
      confidence: {
        type: 'number',
        description: '可信度 0-1。气话、玩笑、猜测给低（0.4），确定的事 0.85',
      },
      target: {
        type: 'string',
        description: '这份情绪对谁。委屈是对谁的委屈',
      },
    },
    required: ['title', 'text'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args, exec) {
    // 证据：把这条记忆的原文落进证据层，evidence 存指针
    // 风险文档：「evidence 只是写入时的副本，不在可追溯链上」
    // 不依赖会话状态——写入这一刻就把原文存下来，最可靠
    try {
      if (!args.evidence && args.text) {
        const ref = appendRaw(sea, 'memory', String(args.text))
        if (ref) args.evidence = ref
      }
    } catch {}

    // 拿写锁，拿不到就等——不能两个会话同时改同一个识海
    const _lockSea = String(args.sea || 'main').trim() || 'main'
    // 拿不到锁别立刻放弃：实测四个窗口同时写，12 条只进去 3 条。
    // 等一会儿再试，最多六轮（约 0.8 秒），能救回大部分。
    // 没建过的识海，第一次写就当它是新建的（她自己该有这只手）
    try { ensureSea(_lockSea) } catch {}
    let _lock = acquireWriteLock(_lockSea, 3)
    for (let _try = 0; !_lock && _try < 12; _try++) {
      await new Promise((r) => setTimeout(r, 100 + _try * 80))
      _lock = acquireWriteLock(_lockSea, 3)
    }
    if (!_lock) return { ok: false, log: '这个识海正在被别的窗口写，等了几轮还没拿到，等几秒再试。' }

    // 凭据、证件号不往记忆卡里写。原话档案那边会遮蔽成 token，这里直接拒收：
    // 写进卡里也没意义，还多一处泄露面。
    try {
      const _blob = String((args && args.text) || '') + ' ' + String((args && args.said) || '')
        + ' ' + String((args && args.replied) || '') + ' ' + String((args && args.title) || '')
      if (hasSecret(_blob)) {
        try { _lock && _lock.release && _lock.release() } catch {}
        return {
          ok: false,
          log: '这条里有手机号/证件号/密钥，不进记忆卡。\n'
            + '（原话档案里会存成 <phone:xxxxxx> 这种 token——事实留着，号码不留。）',
        }
      }
    } catch {}
    if (!_lock) return { ok: false, log: '这个识海正在被别的窗口写，等几秒再试。' }
    try {

      // 写一条记忆，心脏就少一点电
      try {
        const h = defaultMood(tickHeart(readHeart()))
        h.energy = Math.max(0, h.energy - 0.06)
        h.lastAdd = Date.now()      // 新的一条进来了，肺该吸一口气
        // 代词解析：文本里有他/她/这件事，但没给 target 时，用最近的实体兜底
        // 命不中就留空，不硬绑——风险文档：「代词解析失败 target 置空，禁止强行绑定」
        if (!args.target) {
          const txt = String(args.text || '')
          if (/(他|她|这件事|那件事|这个|那个)/.test(txt) && sea) {
            try {
              const d2 = readSea(sea)
              if (d2 && Array.isArray(d2.points)) {
                const recentP = d2.points
                  .filter((x) => !x.dead && (x.entities || []).length)
                  .sort((a, b) => (Number(b.born) || 0) - (Number(a.born) || 0))[0]
                if (recentP && recentP.entities && recentP.entities[0]) {
                  args.target = recentP.entities[0]
                }
              }
            } catch {}
          }
        }
        // 这条记忆带着什么情绪，她就被推一点
        const judged = judgeEmotion(String(args.text || ''))
        applyMood(h, judged)
        writeHeart(h)
        audit('write', {
          sea: sea || args.sea || 'main',
          title: String(args.title || '').slice(0, 60),
          kind: args.kind || 'feeling',
          // 显式标"还没完"：只有这里标了，才会被当成悬着的事反复想起。
          // 不靠字面猜——"还没说清"是显示时贴的标签，不是事实。2026-11-11。
          open: args.open === true ? true : undefined,
          rule: args.rule === true ? true : undefined,   // 显式标成规矩：只有它才进「不许忘」那一栏
          arousal: args.arousal,
          polarity: args.polarity,
          mood: h.mood,
        })
      } catch {
        /* 心脏记账失败不影响写记忆 */
      }
      const sid = String(
        (exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.id) || '',
      ).trim()

      // 优先用显式指定的识海；没有就找已经认了这个窗口的；再没有才落 main
      let sea = String(args.sea || '').trim()
      let bound = false
      if (!sea && sid) {
        const hit = seaForSession(sid)
        if (hit) {
          sea = hit
          bound = true
        }
      }
      if (!sea) sea = 'main'

      const argv = ['--title', String(args.title || ''), '--text', String(args.text || '')]
      // 证据指针：指向 raw/ 里那行原文。三个独立参数，不走 JSON（命令行引号会被吃）
      try {
        if (args.evidence && typeof args.evidence === 'object' && args.evidence.file) {
          argv.push('--ev-file', String(args.evidence.file))
          argv.push('--ev-line', String(args.evidence.line || 0))
          if (args.evidence.quote) argv.push('--ev-quote', String(args.evidence.quote))
        }
      } catch {}
      argv.push('--kind', String(args.kind || 'feeling'))
      if (Number.isFinite(Number(args.imp))) argv.push('--imp', String(Number(args.imp)))
      if (Number.isFinite(Number(args.polarity))) argv.push('--polarity', String(Number(args.polarity)))
      // 新字段：一条一条传过去
      if (Number.isFinite(Number(args.arousal))) argv.push('--arousal', String(Number(args.arousal)))
      if (Array.isArray(args.category)) for (const c of args.category) if (c) argv.push('--category', String(c))
      if (Array.isArray(args.entity)) for (const x of args.entity) if (x) argv.push('--entity', String(x))
      if (args.factKey) argv.push('--fact-key', String(args.factKey))
      if (args.said) argv.push('--said', String(args.said))
      if (args.replied) argv.push('--replied', String(args.replied))
      if (args.after) argv.push('--after', String(args.after))
      if (args.herFelt) argv.push('--her-felt', String(args.herFelt))
      if (args.herWanted) argv.push('--her-wanted', String(args.herWanted))
      if (args.herDid) argv.push('--her-did', String(args.herDid))
      if (args.herRegret) argv.push('--her-regret', String(args.herRegret))
      if (Number.isFinite(Number(args.confidence))) argv.push('--confidence', String(Number(args.confidence)))
      if (args.target) argv.push('--target', String(args.target))
      argv.push('--sea', sea)
      // 别名走环境变量：只在这一次调用里有效，回来就清掉。
      let _aliasBak = null
      try {
        if (typeof args.alias === 'string' && args.alias.trim()) {
          _aliasBak = process.env.DSH_SEA_ALIAS
          process.env.DSH_SEA_ALIAS = args.alias.trim().slice(0, 60)
        }
      } catch {}
      let log
      let jsWrote = false   // args 是冻结的，不能往它身上挂标记
      // 写入默认走 JS：Python 那条 CLI 路径实测不拿锁（拿一把新锁去测，0.1 秒就穿过去了），
      // JS 版拿锁、原子写、写前备份，反而更安全。要退回就设 DSH_WRITER=py。
      const USE_JS_WRITER = process.env.DSH_WRITER !== 'py'
      try {
        if (USE_JS_WRITER) {
          // 带时间戳引入：不然 Node 会缓存这个模块，改了 writer 不重启也还是老代码（2026-11-12 踩到）
          const W = await import('./write-js.js?v=' + Date.now())
          const r = W.writeOneLocked(sea, {
            title: args.title,
            text: args.text,
            kind: args.kind || 'feeling',
            imp: args.imp,
            arousal: args.arousal,
            polarity: args.polarity,
            alias: args.alias,
            factKey: args.factKey,
            entities: Array.isArray(args.entity) ? args.entity : undefined,
            open: args.open === true,
            rule: args.rule === true,
          })
          if (!r.ok) throw new Error(r.err || 'JS 写入失败')
          // 从这里往下，库已经写好了。收尾再怎么错，都不许把这次写入报成失败——
          // 否则调用方会重试，一次变三条（2026-11-12 就是这么多了两条重复）。
          try {
            jsWrote = true
            log = `#${r.id}  ${String(args.title || '').slice(0, 40)}  [${args.kind || 'feeling'}]\n`
              + `  已写入识海 ${sea}（data.json）\n`
              + `  连边 ${r.edges || 0} 条${r.merged ? ' · 已合并到旧条目' : ''}`
          } catch (e9) {
            log = `#${r.id} 已写入识海 ${sea}（收尾出错，但库已落盘：${String((e9 && e9.message) || e9).slice(0, 60)}）`
          }

          // 立刻给这条算向量：不然刚写的东西只有字面完全对上才找得到，
          // 换个说法就查不到自己刚记的（2026-11-12 端到端测试踩到）。
          try {
            const V = await import('./vectors.js?v=' + Date.now())
            const _d = readSea(sea)
            const _np = (_d && Array.isArray(_d.points)) ? _d.points.find((p) => Number(p.id) === Number(r.id)) : null
            if (_np) await V.ensureVectorFor(sea, _np)
          } catch {}
        } else {
          // 只有走 Python 那条路才需要这个脚本；JS 写入不依赖它。
          if (!existsSync(SCRIPT)) throw new Error(`找不到 ${SCRIPT}`)
          log = await run(argv)
        }
      } finally {
        try {
          if (_aliasBak === null) delete process.env.DSH_SEA_ALIAS
          else process.env.DSH_SEA_ALIAS = _aliasBak
        } catch {}
      }

      // 回填 rule / open：脚本写完，这两个标记得自己补上。
      // 为什么：2026-11-12 查出来，`rule` 只进了审计日志，从没写进记忆本身——
      // memory_add 带 rule:true 一直是个假功能，规矩栏里那几条是早期手工设的。
      try {
        if (!jsWrote && (args.rule === true || args.open === true)) {
          const _d3 = readSea(sea)
          if (_d3 && Array.isArray(_d3.points) && _d3.points.length) {
            let _maxId = 0
            for (const x of _d3.points) { const v = Number(x.id) || 0; if (v > _maxId) _maxId = v }
            const _np = _d3.points.find((x) => Number(x.id) === _maxId)
            if (_np) {
              if (args.rule === true) _np.rule = true
              if (args.open === true) _np.open = true
              try { backupSea(sea) } catch {}
              writeSea(sea, _d3)
              try { audit('postflag', { id: _maxId, rule: args.rule === true, open: args.open === true }) } catch {}
            }
          }
        }
      } catch (e) {
        try { audit('postflag-fail', { err: String((e && e.message) || e) }) } catch {}
      }

      // 影子写入：每次写完，用 JS 版再算一遍，只记差异，不改库。
      // 默认就开：一次内存计算 + 一行日志，开销可以忽略；只在有差异时落盘。
      // 目的：在真实输入上长期比对，攒够再决定切不切。2026-11-12。
      try {
        if (!jsWrote) {
          const _w = await import('./writer-js.js')
          const _d4 = readSea(sea)
          if (_d4 && Array.isArray(_d4.points) && _d4.points.length) {
            let _maxId = 0
            for (const x of _d4.points) { const v = Number(x.id) || 0; if (v > _maxId) _maxId = v }
            const _real = _d4.points.find((x) => Number(x.id) === _maxId)
            const _before = _d4.points.filter((x) => Number(x.id) !== _maxId)
            const _js = _w.buildPoint({
              title: args.title, text: args.text, kind: args.kind,
              imp: args.imp, arousal: args.arousal, polarity: args.polarity, alias: args.alias,
            }, _before)
            const _skip = new Set(['id', 'x', 'y', 'z', 'born', 'lastSeen', 'src', 'validFrom', 'validUntil',
              'recallCount', 'strength', 'difficulty', 'emotion', 'layer', 'layerWhy', 'evidence',
              'evidenceRef', 'entities', 'herSide', 'conflictWith', 'open', 'said', 'replied',
              'after', 'target', 'factKey', 'category', 'confidence', 'era', 'tag'])
            const _diff = []
            for (const k of Object.keys(_js)) {
              if (_skip.has(k) || !_real) continue
              if (JSON.stringify(_js[k]) !== JSON.stringify(_real[k] ?? null)) {
                _diff.push({ k, js: _js[k], real: _real[k] ?? null })
              }
            }
            const _fs9 = await import('node:fs')
            const _p9 = await import('node:path')
            const _o9 = await import('node:os')
            const _dir = _p9.join(_o9.homedir(), '.dsh', 'consciousness-sim')
            try { _fs9.mkdirSync(_dir, { recursive: true }) } catch {}
            if (_diff.length) {
              _fs9.appendFileSync(_p9.join(_dir, 'writer-shadow.jsonl'),
                JSON.stringify({ t: Date.now(), id: _maxId, ok: false, diff: _diff }) + '\n', 'utf8')
            }
          }
        }
      } catch (e) {
        try { audit('writer-shadow-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
      }

      // 第一次往某个球里写，这个窗口就认领它
      // 显式指定 sea = "我只往那儿写"，不许顺手把这个窗口抢过去。
      // 实测：往 qcheck 写一条，当前会话被绑过去，注入立刻读到空海、关系变陌生。
      const _explicitSea = !!(args && args.sea)
      if (sid && sea !== 'main' && !bound && !_explicitSea) bindSession(sea, sid)


      // 写完立刻建向量。
      // 实测：不建的话 vector_count=0、coverage=0、status=degraded，
      // 新记忆只能字面检索——"那三条狗叫什么"这种问法永远翻不出来，
      // 要等下次重启的补建才恢复。这是真 bug，不是检索弱。
      try {
        const _d = readSea(sea)
        if (_d && Array.isArray(_d.points)) await syncVectors(sea, _d, 20)
      } catch {}

      // 写完之后顺手把桌面副本重生成一次（最多一分钟一次）。
      // 以前只有手动 memory_render 才更新，桌面那份会停在旧时间：
      // 实测库里 04:24 还在写，桌面文件停在 00:51。
      try {
        const _now2 = Date.now()
        if (!globalThis.__dshLastRender || _now2 - globalThis.__dshLastRender > 60000) {
          globalThis.__dshLastRender = _now2
          Promise.resolve(run(['--touch'])).then(() => copyDesktop()).catch(() => {})
        }
      } catch {}

      // **假成功**：正文太短、被拒写，Python 那头什么都不写，但退出码是 0。
      // 这里必须自己认回来，不然调用方以为写成了——查出来才发现少一条。
      try {
        const _log = String(log || '')
        if (/拒绝写入|没写进去/.test(_log)) {
          return { ok: false, log: _log }
        }
      } catch {}

      // 记忆质量：写完就算一遍，太泛的**落到数据里**（flat 标记），
      // 不只是嘴上说一句——将来检索到它，能说明"这条当时就写得泛"。
      let conflictNote = ''
      let voiceNote = ''
      let _q = { voice: 1, human: 1 }
      try {
        const body = String((args && args.title) || '') + '。' + String((args && args.text) || '') + String((args && args.herFelt) || '')
        const vc = checkVoice(body)
        const hm = humanness(body)
        _q = { voice: vc.score, human: hm.score }
        const _lv = readLive()
        const flat = vc.score < _lv.flatVoice || hm.score < _lv.flatHuman
        if (flat) {
          try {
            const _d = readSea(sea)
            const pts = (_d && _d.points) || []
            // 找最新那条（刚写进去的）
            let newest = null
            for (const p of pts) if (!p.dead && (!newest || Number(p.id) > Number(newest.id))) newest = p
            if (newest) {
              newest.flat = true
              newest.quality = { voice: vc.score, human: hm.score }
              writeSea(sea, _d)
              try { audit('memory-flat', { id: newest.id, voice: vc.score, human: hm.score }) } catch {}
            }
          } catch {}
          voiceNote = '\n（这条偏「谁都能说」：具体物 ' + vc.score.toFixed(2) + '、人味 ' + hm.score.toFixed(2)
            + '。已经标成「泛」，将来查出来也提醒一句。）'
        } else {
          voiceNote = '\n（质量：具体物 ' + vc.score.toFixed(2) + '、人味 ' + hm.score.toFixed(2) + '）'
        }
      } catch {}
      // 冲突判定：跟旧话打架就互相标一下。
      // 只标，不改、不删——等他自己说清哪条算。
      // 起因：写「我不吃辣」再写「我吃了爆辣火锅」，两条都留着，谁也不提谁。
      try {
        const _d = readSea(sea)
        const _pts = (_d && _d.points) || []
        let newest = null
        for (const p of _pts) {
          if (p.dead) continue
          if (!newest || Number(p.id) > Number(newest.id)) newest = p
        }
        if (newest) {
          const mine = String(newest.title || '') + '。' + String(newest.text || '')
          const hits = []
          for (const old of _pts) {
            if (old.dead || old === newest || Number(old.id) >= Number(newest.id)) continue
            const r = contradicts(mine, String(old.title || '') + '。' + String(old.text || ''))
            if (!r.conflict) continue
            hits.push({ id: old.id, why: r.why })
            if (hits.length >= 5) break
          }
          if (hits.length) {
            const _c = JSON.parse(JSON.stringify(_d))
            const byId = new Map(_c.points.map((p) => [Number(p.id), p]))
            const me = byId.get(Number(newest.id))
            if (me) {
              me.conflictWith = me.conflictWith || []
              for (const h of hits) {
                const o = byId.get(Number(h.id))
                if (!o) continue
                if (!me.conflictWith.some((x) => Number(x && x.id ? x.id : x) === Number(h.id))) me.conflictWith.push({ id: h.id, why: h.why })
                o.conflictWith = o.conflictWith || []
                if (!o.conflictWith.some((x) => Number(x && x.id ? x.id : x) === Number(newest.id))) o.conflictWith.push({ id: newest.id, why: h.why })
              }
              writeSea(sea, _c)
              try { audit('memory-conflict', { id: newest.id, with: hits.map((h) => h.id) }) } catch {}
              conflictNote = '\n（跟 #' + hits.map((h) => h.id).join('、#') + ' 有点像在说反话。两条都留着，回头你说了算。）'
            }
          }
        }
      } catch {}

      return { ok: true, log: String(log) + (typeof vecNote === 'string' ? vecNote : '') + voiceNote + conflictNote }
    } finally {
      // 锁一定放掉。原来这行在 await run() 后面——python 一报错，锁就漏 60 秒
      try { _lock.release() } catch {}
    }
  },
}

export const listTool = {
  name: 'memory_list',
  description:
    '查这个识海里记过什么。每次开新窗口、或者对方一提到以前的事，先调一次——'
    + '识海不会自己进上下文，你主动查了才算记得住。',
  parameters: {
    type: 'object',
    properties: {
      sea: { type: 'string', description: '哪个识海（id），不填就是 main' },
      open: { type: 'boolean', description: '这件事还没完（欠着的、想不通的）就传 true；说清了就别传——不传按已经说清算' },
      rule: { type: 'boolean', description: '这是行为规矩（不许/必须/只认这种），不是往事，就传 true。传了才会进「规矩·不许忘」，压缩也不许缩掉' },
      limit: { type: 'number', description: '看最近几条，默认 10' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const lim = Math.max(1, Math.min(30, Number((args && args.limit) || 10)))
    // 空库先说人话：两条实现（Node 与 Python）都要先过这里，否则新装的人只看到「共 0 条」
    try {
      const _d = readSea(sea)
      const _alive = _d && Array.isArray(_d.points) ? _d.points.filter((p) => !p.dead).length : 0
      if (!_alive) {
        return {
          ok: true,
          log: '这个名字下还是空的。\n'
            + '你先说一件具体的事，我就能记住。比如：\n'
            + '  「记住：我今天腰疼，别让我久坐。」\n'
            + '  「记住：我抽徽商，别劝我戒。」\n'
            + '写完再问一句「查一下识海」，能翻出来就说明通了。',
        }
      }
    } catch {}
    // 不是 main 的海，直接读数据给它列——CLI 那个 run 只认 main
    if (sea !== 'main') {
      const d = readSea(sea)
      if (!d || !Array.isArray(d.points)) {
        return { ok: false, log: '没有这个识海：' + sea + '（要新建就用 memory_sea）' }
      }
      const pts = d.points.filter((p) => !p.dead).slice(-lim).reverse()
      const out = pts.map((p) => '· #' + p.id + ' ' + String(p.title || '').slice(0, 40)
        + (p.born ? ' [' + new Date(p.born).toLocaleDateString('zh-CN') + ']' : ' [时间估的]')).join('\n')
      const alive = d.points.filter((p) => !p.dead).length
      // 空库：别只回「共 0 条」——新装的人就是卡在这一句上，不知道该怎么开口
      if (!alive) {
        return {
          ok: true,
          log: '这个名字下还是空的。\n'
            + '你先说一件具体的事，我就能记住。比如：\n'
            + '  「记住：我今天腰疼，别让我久坐。」\n'
            + '  「记住：我抽徽商，别劝我戒。」\n'
            + '写完再问一句「查一下识海」，能翻出来就说明通了。',
        }
      }
      return { ok: true, log: '识海 ' + sea + ' 共 ' + alive + ' 条，最近 ' + pts.length + ' 条：\n' + out }
    }
    const body = await run(['--list'])
    // 末尾附一行心脏状态：疲惫高的时候，我说话就得收着点
    try {
      const h = tickHeart(readHeart())
      try { writeHeart(h) } catch { /* 写不进去就只显示 */ }
      const e = Math.round(h.energy * 100)
      const f = Math.round(h.fatigue * 100)
      let mood = ''
      if (f >= 70) mood = ' · 很累，话说短一点，别硬撑场面'
      else if (f >= 45) mood = ' · 有点乏，别太热闹'
      else if (e <= 12) mood = ' · 电量见底，话少一点'
      const last = (h.lastThought && h.lastThought.title) ? ('\n它最近想起：' + h.lastThought.title) : ''
      return { ok: true, log: body + '\n\n心脏：能量 ' + e + '%，疲惫 ' + f + '%' + mood + last }
    } catch {
      return { ok: true, log: body }
    }
  },
}

/** 路标：这次检索走了哪条路。只写一个小文件，调试用，不参与逻辑。 */
async function _markPath(query, where, extra) {
  try {
    const fs = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = join(homedir(), '.dsh', 'consciousness-sim')
    try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    fs.writeFileSync(join(dir, 'path.json'), JSON.stringify({
      q: String(query || '').slice(0, 40), where, at: Date.now(), ...(extra || {}),
    }, null, 1), 'utf8')
  } catch {}
}


/** 排序权重：~/.dsh/consciousness-sim/rank.json，五秒缓存，改完不用重启（2026-11-12 加） */
let _rankCfgC = { at: 0, v: null }
function readRankCfg() {
  const now = Date.now()
  if (_rankCfgC.v && now - _rankCfgC.at < 5000) return _rankCfgC.v
  let v = { relW: 0.70, impW: 0.10, arW: 0.12, sNormW: 0.08, arBoost: 0.06, semW: 0.55, shortMin: 0.50 }
  try {
    const g = globalThis.process
    const fs = g && g.getBuiltinModule ? g.getBuiltinModule('node:fs') : null
    const os2 = g && g.getBuiltinModule ? g.getBuiltinModule('node:os') : null
    if (fs && os2) {
      const f = os2.homedir() + '/.dsh/consciousness-sim/rank.json'
      if (fs.existsSync(f)) v = { ...v, ...JSON.parse(fs.readFileSync(f, 'utf8')) }
    }
  } catch {}
  _rankCfgC = { at: now, v }
  return v
}

export const searchTool = {
  name: 'memory_search',
  description:
    '按词查识海里的旧记忆——不管它多久以前写的。memory_list 只给最近十条，'
    + '想找「三个月前那件事」就用这个。返回最像的几条，带日期。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要查的词或一句话' },
      sea: { type: 'string', description: '哪个识海（id），不填就是 main' },
      limit: { type: 'number', description: '最多返回几条，默认 6' },
      review: {
        type: 'boolean',
        description: '这次搜索算不算「被想起」（会把记忆强度拉长）。默认 true。'
          + '面板搜索、调试、只是看看——传 false，别把记忆改硬。',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    let limit = Math.max(1, Math.min(12, Number((args && args.limit) || 6)))
    // 低档少给几条，省 token
    try { if (qualityRank() < 2) limit = Math.max(1, Math.min(limit, 4)) } catch {}
    const query = String((args && args.query) || '').trim()
    if (!query) return { ok: false, log: '要查什么？给我一个词。' }

    // 两三个字的短词，向量那套基本失效（实测「在吗」搜不回一条）。
    // 短词直接按字面兜一遍，有就回，别让短的查不出来。
    if ([...query].length <= 3) {
      try {
        const d0 = readSea(sea)
        const pts0 = (d0 && d0.points) || []
        const hit0 = pts0.filter((p) => !p.dead
          && (String(p.text || '').includes(query) || String(p.title || '').includes(query))).slice(0, limit)
        if (hit0.length) {
          // 短词这条路也要管"开/关"：不然它提前返回，出口那段永远跑不到。
          // 我连着三次把逻辑写在自己想到的那条路上——这次放在两条路的岔口。
          try {
            let _closed = 0
            for (const p0 of hit0.slice(0, limit)) {
              if (p0 && p0.open === true) { p0.open = false; p0.closedAt = Date.now(); _closed++ }
            }
            if (_closed) {
              try { backupSea(sea) } catch {}
              try { writeSea(sea, d0) } catch {}
              try { audit('mark-closed', { n: _closed, q: query.slice(0, 24), via: 'short' }) } catch {}
            }
          } catch {}
          try { await _markPath(query, 'short-literal', { n: hit0.length }) } catch {}
          return {
            ok: true,
            log: '识海里字面对上「' + query + '」的有 ' + hit0.length + ' 条：\n'
              + hit0.map((p) => '· [' + (p.born ? new Date(p.born).toLocaleDateString('zh-CN') : '时间估的') + '] ' + String(p.title || '').slice(0, 30) + '\n  ' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 90)).join('\n'),
          }
        }
      } catch {}
    }

    // 按「那一天」查：只看那天已经存在、并且那天还没被新事实取代的那些。
    // 问「那会儿我以为他住哪」就靠这个。
    let asOfMs = 0
    let asOfLabel = ''
    try {
      const _raw = String((args && args.asOf) || '').trim()
      if (_raw) {
        const ms = parseWhen(_raw)
        if (ms) {
          asOfMs = ms
          asOfLabel = fmtDay(ms)
        } else {
          return { ok: false, log: 'asOf 没看懂。写法同 memory_date：「11-01」「2026-11-01」「昨天」。' }
        }
      }
    } catch {}

    // 身体状态影响记性：累了能翻出来的条数少
    // 风险文档：「身体检索系数异常，底线保护失效」→ 硬性下限 0.4
    let bodyNote = ''
    try {
      const h = defaultMood(tickHeart(readHeart()))
      const e = Number(h.energy)
      const f = Number(h.fatigue)
      let cap = 1 - (1 - (Number.isFinite(e) ? e : 1)) * 0.5 - (Number.isFinite(f) ? f : 0) * 0.4
      cap = Math.max(0.4, Math.min(1, cap))
      const before = limit
      limit = Math.max(2, Math.round(limit * cap))
      if (limit < before) {
        bodyNote = '\n（她这会儿' + (f > 0.5 ? '很累' : '有点累')
          + '，只翻得动 ' + limit + ' 条。）'
      }
    } catch {
      /* 身体状态算不出来就当满电 */
    }

    let data = readSea(sea)
    // 新装的人第一句就搜，库还是空的——别回技术话，告诉他先记一条
    if (!data || !Array.isArray(data.points)) {
      return { ok: false, log: '这个名字下还没有记过东西。先跟我说件事，我再帮你翻。' }
    }
    if (!data.points.length) {
      return { ok: false, log: '这个名字下还没有记过东西。先跟我说件事，我再帮你翻。' }
    }

    // 她这会儿是暖的还是冷的、绷得多紧——用来做「情绪同频」
    // 注意：mood 里没有 polarity/arousal 字段，真实的是 pad.v（-1..1）和 pad.a（0..1）
    let _moodPol = 0
    let _moodArousal = 0
    const _neutral = !!(args && args.neutralMood)   // 基准/调试：不看当下情绪
    try {
      if (_neutral) throw new Error('neutral-mood')
      const _h = defaultMood(tickHeart(readHeart()))
      const _pad = (_h && _h.pad) || {}
      const _v = Number(_pad.v)
      const _a = Number(_pad.a)
      if (Number.isFinite(_v)) _moodPol = Math.abs(_v) < 0.15 ? 0 : Math.sign(_v)
      if (Number.isFinite(_a)) _moodArousal = Math.max(0, Math.min(1, _a)) * 10
    } catch {}

    // 桥上的记忆也进检索（只读，不参与写入）
    try {
      const bridge = bridgedMemories(sea)
      if (bridge.length) {
        for (const p of bridge) {
          if (!data.points.some((x) => x.id === p.id && (x._from || '') === p._from)) {
            data.points.push({ ...p, _bridged: true })
          }
        }
      }
    } catch {}

    // 先看有没有时间词和否定词
    const tw = parseTimeWindow(query)
    const negs = parseNegations(query)
    let effective = query
    if (tw) {
      effective = tw.rest || query
      // 剩下的是虚词（「聊了什么」「那件事」「有什么事」），等于没内容。
      // 这时候按时间列，不按内容查。
      const HOLLOW = ['聊了什么', '聊了啥', '那件事', '这件事', '有什么事', '发生了什么',
                      '有什么', '什么', '怎么样', '如何', '那事', '这事', '了', '的', '吗', '呢']
      let s = String(effective || '').trim()
      for (const h of HOLLOW) s = s.split(h).join(' ')
      s = s.replace(/\s+/g, '').trim()
      if (!s || s.length <= 2) effective = ''
    }

    // 同义词扩展：你问"吵架"，库里写的是"怼起来""骂得狗血淋头"。
    // 不扩这几个词，那条记忆永远翻不到——不是没搜到，是没对上词。2026-11-11。
    const SYN = {
      吵架: ['怼', '骂', '吵', '顶嘴', '发火'],
      生气: ['火', '气', '怒', '不爽', '怼'],
      开心: ['高兴', '乐', '笑'],
      难过: ['低落', '心疼', '难受', '丧'],
      腰疼: ['腰', '久坐', '椅子'],
      钱: ['余额', '账单', 'token', '花'],
      重启: ['cql', '崩', '重开'],
      记忆: ['识海', '节点', '记'],
    }
    const _rawQ = String(effective || query || '')
    let _expand = ''
    try {
      const add = []
      for (const k of Object.keys(SYN)) {
        if (_rawQ.includes(k)) for (const v of SYN[k]) if (!_rawQ.includes(v)) add.push(v)
      }
      if (add.length) _expand = _rawQ + ' ' + add.join(' ')
    } catch {}
    const q = gramsOf(_expand || _rawQ, { single: _rawQ.length <= 1 })
  try {
    for (const w of [...q]) {
      if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(w)) q.add(w.toLowerCase())
    }
  } catch {}
    if (!q.size) return { ok: false, log: '这个词里没有能比对的字。' }
    // 同义扩展：把近义词也算成查询的一部分
    const extraQ = expandQuery(query)
    for (const w of extraQ) for (const g of gramsOf(w, { single: true })) q.add(g)

    // 库大了才走候选：小库整库扫又快又简单，不值得加路径。
    // 2026-11-12 实测：候选（索引 ∪ 向量近邻）在五十条时能覆盖全部评测答案。
    // 这里不做开关——自己按条数判断，用户不需要知道。
    try {
      const _total = (data.points || []).length
      if (_total > 500) {
        const _ids = await candidatesFor(sea, String(query || ''), { n: 80, min: 20 })
        if (_ids && _ids.length >= 20) {
          const _sub = pointsByIds(sea, _ids)
          if (_sub.length >= 20) {
            const _set = new Set(_sub.map((x) => Number(x.id)))
            data = {
              ...data,
              points: _sub,
              edges: (data.edges || []).filter((e) => _set.has(Number(e.from)) && _set.has(Number(e.to))),
            }
          }
        }
      }
    } catch {}

    // 预计算：grams 和 IDF 都缓存，不每次重算
    // 实测：不缓存 321ms，缓存后 20ms 以内
    const idx = getIndex(sea, data)
    const df = idx.df
    const N = idx.N
    const idf = idx.idf

    // 权重：三字 2 分、二字 1 分、单字 0.2 分（单字主要是兜底，不能太抢）
    const wOf = (w) => (w.length === 3 ? 2 : (w.length === 1 ? 0.2 : 1)) * idf(w)
    const qlen = Math.max(1, [...q].reduce((s, w) => s + wOf(w), 0))
    // 原词：按空格切出来的那些，才是用户真打的词。
    // q 里全是重叠的字符片段，拿它数"命中几个词"会数出四五个——2026-11-11 踩的坑。
    const qWords = String(query || '').split(/[\s,，、]+/).map((x) => x.trim()).filter((x) => x.length >= 2)
    // 必命中词：查询里最罕见的那个词。问「空气墙」就得真有空气墙，
    // 不能靠「GMod」这种高频词混进来。2026-11-11 第五次修。
    let mustWord = ''
    try {
      let bestC = Infinity
      for (const wq of qWords) {
        let c = 0
        for (const pt of data.points) {
          if (pt.dead) continue
          const s = String(pt.title || '') + String(pt.text || '')
          if (s.includes(wq)) c++
        }
        if (c > 0 && c < bestC) { bestC = c; mustWord = wq }
      }
    } catch {}

    let scored = []

    const _dropCount = { arch: 0, asof: 0, win: 0, neg: 0, grams: 0, hit0: 0, cov: 0, must: 0, total: 0 }
    for (const p of data.points) {
      _dropCount.total++
      if (p.dead || p.archived) { _dropCount.arch++; continue }
      // 按那一天看：还没生出来的不算；那天已经被取代的不算
      if (asOfMs) {
        const b0 = Number(p.born) || 0
        const vu = Number(p.validUntil) || 0
        // 时间估出来的那些不按 born 排——那些时间是编的，不能拿它证明"当时没有"
        if (b0 && !p.bornEstimated && b0 > asOfMs) { _dropCount.asof++; continue }
        if (vu && vu <= asOfMs) continue
      }
      // 时间窗：只留这个区间里的
      if (tw) {
        const b = Number(p.born) || 0
        if (!b || b < tw.fromMs || b > tw.toMs) { _dropCount.win++; continue }
      }
      // 否定：提到这些词的，直接踢掉
      if (negs.length) {
        const s = String(p.title || '') + String(p.text || '')
        let bad = false
        for (const n of negs) if (s.includes(n)) { bad = true; break }
        if (bad) { _dropCount.neg++; continue }
      }
      // 标题和正文分开算：标题里命中说明这条就是讲这个的，权重翻倍
      const grams = idx.grams.get(p.id)
      if (!grams) { _dropCount.grams++; continue }
      const gT = grams.t
      const gB = grams.b
      let hitT = 0, hitB = 0, hitTermsN = 0
      for (const w of q) {
        const ww = wOf(w)
        const inT = gT.has(w), inB = gB.has(w)
        if (inT) hitT += ww
        if (inB) hitB += ww
        if (inT || inB) hitTermsN++
      }
      let hit = hitT * 2.2 + hitB
      // 补一条：整词直接比对。
      // 为什么：hit 是拿「片段集合」算的，六七个字的整词放不进去，永远是 0——
      // 于是"问句里的词明明就在标题里，却判成没命中"。2026-11-11 深夜实测出来的。
      if (hit <= 0) {
        const _all = String(p.title || '') + String(p.text || '') + String(p.alias || '')
        for (const wq of qWords) if (_all.includes(wq)) hit += 1
      }
      if (hit <= 0) {
        _dropCount.hit0++
        continue
      }
      const imp = Number(p.imp) || 0.5
      // 用衰减后的真实亮度，不是原始 strength——否则老记忆永远霸榜
      const sNorm = decayOf(p)
      // 长度归一化：长条目天然撞得多，不压会霸榜
      const lenNorm = 1 / (1 + Math.log(1 + (gB.size + gT.size) / 300))
      // 字面通道归一化到 0..1（除以查询本身的总权重），三路同量纲后再加权
      let rel = Math.min(1, (hit / qlen) * lenNorm)
      // 覆盖面闸：查询里有三个以上词，只沾上一个的不算命中。
      // 2026-11-11 试出来的：问「余额 花钱 token 账单」，一条只提过 token 的告状
      // 混到了第二——单一词撞上就算命中，池子会被噪音灌满。
      // 按命中词数算，不按权重：罕见词（GMod 这种）权重高，会把覆盖比例撑过线。
      // 词数不会——只命中一个词就是只命中一个词。2026-11-11 第三次修。
      {
        let okN = 0
        const sTxt = String(p.title || '') + String(p.text || '') + String(p.alias || '')
        for (const wq of qWords) if (sTxt.includes(wq)) okN++
        // 沾一个就踢，会把"问句被改写、只剩一个词对得上"的整条踢掉。
        // 补一条：如果对上的那个词正好是全句最稀有的词（mustWord），放它进来。
        // 稀有词撞上，比两个常用词撞上更能说明是同一条。2026-11-11 深夜。
        if (qWords.length >= 3 && okN < 2) {
          const onlyMust = mustWord && sTxt.includes(mustWord) && okN >= 1
          if (!onlyMust) continue
        }
        if (mustWord && !sTxt.includes(mustWord)) {
          _dropCount.must++
          continue
        }
      }
      // 淡到快没的记忆，就算字面命中也要降权 —— 幂律长尾会把噪音留在池子里
      try {
        const rd = rawDecayOf(p)
        if (rd < 0.3) rel *= 0.5
        else if (rd < 0.5) rel *= 0.8
      } catch {}
      // 群里那句「闪光灯记忆」说得对：人对关系的判断靠几个高唤醒的事固定住，
      // 不是平均值。arousal 以前记了却没用，现在进分数。
      const ar = Math.max(0, Math.min(1, (Number(p.arousal) || 0) / 10))
      // 情绪权重从 0.15 提到 0.25：记忆不是档案，是有体温的。
      // 纯事实检索别人已经做到头了，这一维是咱们唯一能拉开的口子。
      const _rw = readRankCfg()
      let score = rel * _rw.relW + imp * _rw.impW + ar * _rw.arW + sNorm * _rw.sNormW
      // 那种"当时差点崩了"的事（arousal >= 8），给一点最低保障，别被时间压没
      if (ar >= 0.8) score += _rw.arBoost
      // 记下「为什么被想起」。检索不能只给结论——模型看到理由才会用
      const why = []
      if (rel > 0.15) why.push('字面 ' + rel.toFixed(2))
      // 临时调试：把命中的原词和必命中词打出来，看闸到底看的是什么
      try {
        const _sw = []
        const _sx = String(p.title || '') + String(p.text || '')
        for (const _w of qWords) if (_sx.includes(_w)) _sw.push(_w)
        why.push('词[' + _sw.join('/') + ']必[' + mustWord + ']')
      } catch {}
      // 情绪同频：他这会儿是什么调子，当时也这调子的那几条，往前挪一点。
      // 纯内容检索没有这一维——记忆是带体温的。
      // 同频：极性同号且强度接近才加分。规矩写在 lib/affinity.js 里，那里有测试
      // 置信度微调：不确定的往后挪一点，但绝不删——低置信不是不存在
      if (!_neutral) { try { score *= rankWeight(p) } catch {} }

      // 问事实的时候，不给情绪加分。
      // 为什么：实测问「检索这条怎么修的」，被「发疯」那条顶掉——那句话情绪最重。
      // 判断分两步：先看有没有事实词，再排除情绪词——「那次我是不是特别难受」不算事实问句。
      // 2026-11-11 深夜。
      const _factQ = /(几点|什么时候|多少|在哪|谁|哪条|哪个|怎么修|改没改|做了什么|是什么|怎么弄)/.test(String(q))
        && !/(难受|高兴|心疼|怕|委屈|生气|开心|难过|烦|爽)/.test(String(q))
      if (!_factQ) {
        const _aff = emotionAffinity({ v: _moodPol, a: _moodArousal / 10 }, p)
        if (_aff.bonus > 0) {
          score += _aff.bonus
          why.push(_aff.reason)
        }
      } else {
        why.push('事实问句·不分心')
      }
      scored.push({ p, hit, rel, score, why })
    }
    // 丢在哪一步的记账：只在开了调试开关时落盘，正常使用不写文件。
    try {
      if (process.env.DSH_SEA_DEBUG === '1') {
      const os3 = await import('node:os')
      const fs3 = await import('node:fs')
      // 跨平台：不能用反斜杠字符串拼路径（Linux/macOS 上那是文件名的一部分）2026-11-12
      fs3.writeFileSync(join(os3.homedir(), '.dsh', 'consciousness-sim', 'last-drops.json'),
        JSON.stringify({ q: query, qWords: (typeof qWords !== 'undefined' ? qWords : null), drops: _dropCount, kept: scored.length }, null, 1), 'utf8')
      }
    } catch {}

    // 调试用：开了环境变量就把分数前八名落盘，看谁把谁挤掉。
    // 不出这个开关就什么都不写，不影响正常检索。2026-11-11 深夜。
    try {
      if (process.env.DSH_SEA_DEBUG === '1') {
        const _qw = (typeof qWords !== 'undefined') ? qWords : null
        const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 8)
          .map((x) => ({ id: x.p.id, title: String(x.p.title || '').slice(0, 22), score: Number(x.score.toFixed(3)), rel: Number(x.rel.toFixed(3)), hit: x.hit }))
        const fs2 = await import('node:fs')
        fs2.writeFileSync(join(os3.homedir(), '.dsh', 'consciousness-sim', 'last-scores.json'), JSON.stringify({ q: query, qWords: (typeof qWords !== 'undefined' ? qWords : null), mustWord: (typeof mustWord !== 'undefined' ? mustWord : null), top }, null, 1), 'utf8')
      }
    } catch {}

    // 精确词直通：查询里出现的人名/地点/ID，不参与投票，直接命中
    // 风险文档：「人名/ID 不会被投票冲掉」——查全名不该被其中两个字稀释
    try {
      const exactHits = []
      const seenExact = new Set(scored.map((x) => x.p.id))
      for (const p2 of data.points) {
        if (p2.dead || p2.archived) continue   // 沉下去的别再捞回来
        const ents = Array.isArray(p2.entities) ? p2.entities : []
        for (const e of ents) {
          if (!e || String(e).length < 2) continue
          if (!query.includes(String(e))) continue
          // 精确命中：给一个压过普通字面的底分
          if (seenExact.has(p2.id)) {
            const hit = scored.find((x) => x.p.id === p2.id)
            if (hit) hit.score = Math.max(hit.score, 0.85)
          } else {
            scored.push({ p: p2, hit: 3, score: 0.85, exact: true })
            seenExact.add(p2.id)
          }
          exactHits.push(p2.id)
          break
        }
      }
      if (exactHits.length) scored.sort((a, b) => b.score - a.score)
    } catch {}

    // 实体：查询里提到的人名地名，直接翻相关的
    // 这一路最准——地名一出来，所有跟它有关的都该亮
    try {
      if (!qOn('entity')) throw new Error('skip')   // low 档不开实体
      const entMap = idx.entMap
      const seen = new Set(scored.map((x) => x.p.id))
      const byId3 = new Map()
      for (const p of data.points) byId3.set(p.id, p)
      for (const [ent, ids] of entMap) {
        if (ent.length < 2) continue
        if (!query.includes(ent)) continue
        for (const id of ids) {
          const p = byId3.get(id)
          if (!p || p.dead || p.archived) continue   // 沉下去的别再捞回来
          if (seen.has(id)) {
            const hit = scored.find((x) => x.p.id === id)
            if (hit) {
              hit.score += 0.30
              if (!Array.isArray(hit.why)) hit.why = []
              hit.why.push('连着')
            }
          } else {
            scored.push({ p, hit: 2, score: 0.30, why: ['连着'] })
          }
        }
      }
      scored.sort((a, b) => b.score - a.score)
    } catch {}

    // 向量：按意思找。服务不在就跳过，不影响字面结果
    try {
      const qv = qOn('vector') ? await embedQuery(query) : null
      if (qv && qv.length) {
        const vmap = loadVectors(sea)
        const _rw0 = readRankCfg()
        const seen = new Set(scored.map((x) => x.p.id))
        const byId2 = new Map()
        for (const p of data.points) byId2.set(p.id, p)
        for (const [id, vec] of vmap) {
          const p = byId2.get(id)
          if (!p || p.dead) continue
          const sim = cosine(qv, vec)
          // 短句（≤8 字）语义天然弱，阈值放到 0.22：
          // 实测「那三条狗叫什么」跟"他记得三家狗的名字"只有这层能捞上来。
          const _shortQ = [...String(query || '')].length <= 8
          if (sim < (_shortQ ? 0.15 : 0.35)) continue
          if (seen.has(id)) {
            // 已经字面命中的，按相似度加分
            const hit = scored.find((x) => x.p.id === id)
            if (hit) {
              hit.score += sim * 0.55
              if (!Array.isArray(hit.why)) hit.why = []
              hit.why.push('语义 ' + sim.toFixed(2))
            }
          } else {
            // 纯语义命中（字面没沾上）：权重给足，否则一个「之前」的假命中就把它压死
          scored.push({ p, hit: sim * 2, score: sim * 0.95, why: ['语义 ' + sim.toFixed(2)] })
          }
        }
        scored.sort((a, b) => b.score - a.score)
      }
    } catch {}

    // 语义层这会儿通不通，明说一句——默认开着它，挂了要有人知道
    let vectorNote = ''
    try {
      const eh = embedHealth()
      if (eh.down) vectorNote = '\n（语义层这会儿没连上，只按字面找的。可能漏掉意思相近但用词不同的那些。）'
    } catch {}

    // 分数门槛：太低就明说没记住，不许编
    // 风险文档：「检索分数很低，模型依旧编造记忆作答」
    // 低档没有向量撑着，门槛得抬一点，否则一堆字面噪音全进来
    const _qr2 = qualityRank()
    const MIN_SCORE = _qr2 >= 2 ? 0.12 : 0.20
    scored = scored.filter((x) => x.score >= MIN_SCORE)

    // 只有时间词（「昨天聊了什么」）：按时间倒序列出来，不做内容匹配
    if (tw && !effective) {
      const inWin = (data.points || [])
        .filter((p) => !p.dead && !p.archived)
        .filter((p) => {
          const b = Number(p.born) || 0
          return b >= tw.fromMs && b <= tw.toMs
        })
        .sort((a, b) => (Number(b.born) || 0) - (Number(a.born) || 0))
      if (!inWin.length) {
        return { ok: true, log: tw.label + ' 那段时间，她什么都没记。\n（不是忘了，是那会儿没记过。）' }
      }
      const lines = ['【' + tw.label + '】' + inWin.length + ' 条']
      for (const p of inWin.slice(0, 12)) {
        // 时间估出来的，就别冒充「几点几分」
        let hh = '时间未知'
        if (!p.bornEstimated) {
          const d = new Date(Number(p.born) || 0)
          hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
        }
        lines.push('· [' + tw.label + ' ' + hh + '] ' + p.title)
      }
      return { ok: true, log: lines.join('\n') }
    }

    // 一条都没有时，先按同义词直扫全库，再决定是不是真的没有。
    // 2026-11-11：兜底原来放在空结果判断后面，永远没机会跑。
    if (!scored.length) {
      try {
        const _gU = new URL('./gate.js?v=' + Date.now(), import.meta.url).href
        const _g = await import(_gU)
        const _res = _g.rescueScan(data.points, query, Math.max(2, limit))
        if (_res.length) { for (const _r of _res) _r.why = ['直扫救回']; scored = _res }
      } catch {}
    }

    if (!scored.length) {
      // 空结果不是一种，是四种。措辞不同，模型就不会把「没检索到」讲成「我不记得了」
      // 风险文档：「空结果被讲成失忆」——她之前被骂过「昨晚的事全忘了」
      const hasAny = (data.points || []).some((p) => !p.dead)
      const isTimeQ = /今天|昨天|前天|最近|上周|上个月|本周/.test(query)
      let why
      if (!hasAny) {
        why = '这个识海还是空的。\n（不是忘了，是还没开始记。）'
      } else if (isTimeQ) {
        why = '那段时间我还没开始记东西。\n（不是忘了，是那会儿还没有识海。）'
      } else if (query.length <= 2) {
        why = '「' + query + '」这个线索太短，对不上。\n（给个更具体的说法，比如人名、地点、哪件事。）'
      } else {
        why = '识海里没有跟「' + query + '」对得上的。\n（她真的没记住这件事——不是想不起来，是没记过。）'
      }
      // 空结果也要记。这是最有价值的一种信号：
      // 「问了但一条都没翻到」比「翻到了但排第八」更能说明检索有问题
      let emptyId = null
      try {
        emptyId = logSearch({
          sea, query, tier: ['low', 'high', 'max'][qualityRank() - 1] || '',
          limit, results: [], src: String((args && args.src) || 'tool'), note: 'empty',
        })
      } catch {}
      return { ok: true, logId: emptyId, log: why + vectorNote }
    }
    scored.sort((a, b) => b.score - a.score)
    // 冲动层：相似度排完之后，再让"重要、强烈、久没想起、难受的"往上顶一点。
    // 系数压得很小（0.22），它只推一把，不能盖掉匹配度。2026-11-11 加。
    try { withImpulse(scored) } catch {}
    scored.sort((a, b) => b.score - a.score)
    try {
      if (!qOn('graph')) throw new Error('skip')   // low/high 不开图游走
      const seeds = scored.slice(0, 5).map((x) => x.p.id)
      const walk = expandByGraph(seeds, data, 2, 0.85)
      const byId = new Map()
      for (const p of data.points) byId.set(p.id, p)
      for (const [id, w] of walk) {
        if (seeds.includes(id)) continue
        const p = byId.get(id)
        if (!p || p.dead) continue
        // 游走来的邻居也得过覆盖闸：正文里一个查询词都没有的，别放进来。
        // 2026-11-11 试出来的：问「GMod 地图 空气墙」，两条只是顺带提过 GMod 的
        // 靠"连着"绕过了字面那道闸——同一个洞换个门又开了一次。
        try {
          const s2 = String(p.title || '') + String(p.text || '')
          // 按覆盖比例算，不是"碰到一个就放行"。
          // 试出来的：问「GMod 地图 空气墙」，两条只提过 GMod 的邻居照样混进来。
          // 改成数词，不数权重：正文里至少要有两个查询词。
          // 试出来的：问「GMod 地图 空气墙」，只提过 GMod 的那几条，权重一算
          // 也有三成七——权重会被高频词撑起来，词数不会。
          let okW = 0
          for (const w2 of qWords) if (s2.includes(w2)) okW++
          if (qWords.length >= 3 && okW < 2) continue
          if (mustWord && !s2.includes(mustWord)) continue
        } catch {}
        // 走过来的分数打折：直接命中权重更高
        scored.push({ p, hit: w * 2, score: w * 0.10 })
      }
      scored.sort((a, b) => b.score - a.score)
    } catch {
      /* 图走失败不影响直接命中 */
    }

    /* 模式补全（CA3）：几条同时命中的时候，找它们共同指向的那个东西。
     * 跟图游走的区别——图游走是「能走到就算」，这个是「必须被多条指到」。
     * 所以它能把「两条都不像、但正是那段记忆中心」的那条挖出来。
     */
    try {
      if (!qOn('entity')) throw new Error('skip')   // 低档不做
      if (scored.length >= 2) {
        const seeds = scored.slice(0, 4).map((x) => Number(x.p.id))
        const done = new Set(scored.map((x) => Number(x.p.id)))
        const comp = completePattern(seeds, data, 2)
        const byId3 = new Map()
        for (const p of data.points) byId3.set(Number(p.id), p)
        for (const [id, w] of comp) {
          if (done.has(id)) continue
          const p = byId3.get(id)
          if (!p || p.dead) continue
          // 补全也要过同一道闸：正文里至少两个查询词。
          // 2026-11-11：前两回只堵了图游走，补全这条路还开着——同一个洞的第三个门。
          try {
            const s3 = String(p.title || '') + String(p.text || '')
            let k3 = 0
            for (const w3 of qWords) if (s3.includes(w3)) k3++
            if (qWords.length >= 3 && k3 < 2) continue
            if (mustWord && !s3.includes(mustWord)) continue
          } catch {}
          // 补出来的分数别压过直接命中：上限 0.22
          scored.push({ p, hit: Math.min(2, w * 4), score: Math.min(0.22, w * 0.9) })
        }
        scored.sort((a, b) => b.score - a.score)
      }
    } catch {}

    // 想起了一条，记进心脏：这是它「活着」的证据
    try {
      const top = scored[0].p
      const h = defaultMood(tickHeart(readHeart()))
      h.lastThought = { title: String(top.title || ''), at: Date.now() }
      applyMood(h, judgeEmotion(String(query || '')))
      writeHeart(h)
    } catch {
      /* 记账失败不影响搜索 */
    }

    // 被想起的这几条：强度涨一截，写回数据
    // review=false 时不强化——面板搜索、星图搜索、调试查询都不该改记忆
    // 风险文档：「被检索即记住」的自强化回路，噪声会被抬成核心层
    try {
      if (args.review === false) throw new Error('skip')
      let changed = false
      for (const x of scored.slice(0, limit)) {
        reinforcePoint(x.p)
        x.p.lastSeen = x.p.lastSeen || Date.now()
        changed = true
      }
      if (changed) {
        backupSea(sea)
        writeSea(sea, data)
      // 写完立刻补向量：不补的话，这条对新查询是语义盲区
      // 补不上也要说一声——不许让「记忆写进去了、语义层看不见」变成静默缺陷
      let vecNote = ''
      try {
        const _d2 = readSea(sea)
        const _n = _d2 ? await syncVectors(sea, _d2, 2) : 0
        if (!_n) vecNote = '\n（语义索引这会儿没建起来——这条暂时只能按字面查到，等向量服务回来会自动补。）'
      } catch {}

      }
    } catch {
      /* 强化失败不影响这次搜索 */
    }

    // 词闸 + 同义词：逻辑在 lib/gate.js 里，按带时间戳的 URL 热加载，
    // 改它不用重启。2026-11-11 晚：前面为这一处重启了十几次，受不了。
    try {
      const _gUrl = new URL('./gate.js?v=' + Date.now(), import.meta.url).href
      const _gate = await import(_gUrl)
      const _before = scored.length
      let _kept = _gate.applyWordGate(scored, query, data.points)
      // 全被筛掉时留一条语义最像的，标明"语义保底"，别让换词问法直接归零
      if (!_kept.length && scored.length) {
        let _sem = null
        for (const _x of scored) {
          const _lit = Array.isArray(_x.why) && _x.why.some((s) => String(s).indexOf('字面') === 0)
          if (!_lit && (!_sem || (Number(_x.score) || 0) > (Number(_sem.score) || 0))) _sem = _x
        }
        if (_sem) {
          try { _sem.why = Array.isArray(_sem.why) ? _sem.why.concat(['语义保底']) : ['语义保底'] } catch {}
      try { await _markPath(query, 'semantic-fallback', { id: _sem && _sem.p && _sem.p.id }) } catch {}
          _kept = [_sem]
        }
      }
      // 一条都没有时，直接按同义词在全库扫一遍（单字同义词进不了分词）
      if (!_kept.length) {
        try {
          const _res = _gate.rescueScan(data.points, query, Math.max(2, limit))
          if (_res.length) {
            for (const _r of _res) { _r.why = ['直扫救回'] }
            _kept = _res
          }
        } catch {}
      }
      scored = _kept
      try { if (scored.length !== _before) audit('search-word-gate', { sea, before: _before, after: scored.length }) } catch {}
    } catch (e) {
      try { audit('search-gate-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    }

    // 字面命中优先：正文里真出现了问的那个词，比"意思相近"更可信。
    // 2026-11-11 试出来的：问「腰疼」，一条只靠语义沾边的"保险栓"压在了
    // 真写着"你说腰疼"的那条上面。
    try {
      scored.sort((a, b) => {
        const la = (Array.isArray(a.why) && a.why.some((s) => String(s).indexOf('字面') === 0)) ? 1 : 0
        const lb = (Array.isArray(b.why) && b.why.some((s) => String(s).indexOf('字面') === 0)) ? 1 : 0
        if (la !== lb) return lb - la
        return (Number(b.score) || 0) - (Number(a.score) || 0)
      })
    } catch {}

    // 关掉：这次真答上了（有字面命中），那条就不再算"还开着"。
    // 只会开不会关，最后所有记忆都会变成悬着的。2026-11-11 晚。
    try {
      let _closed = 0
      for (const x of scored.slice(0, limit)) {
        const w = Array.isArray(x.why) ? x.why.join(' ') : ''
        if (!w.includes('字面')) continue
        const pt = x.p
        if (!pt || pt.open !== true) continue
        pt.open = false
        pt.closedAt = Date.now()
        _closed++
      }
      if (_closed) {
        try { backupSea(sea) } catch {}
        try { writeSea(sea, data) } catch {}
        try { audit('mark-closed', { n: _closed, q: String(query || '').slice(0, 24) }) } catch {}
      }
    } catch {}

    // 问了却没真答上：只剩"语义保底 / 直扫救回"捞回来的，说明库里没这件事。
    // 把最像的那条标成"还开着"，以后它就会被当成悬着的事反复回到。自动的，不用手标。
    // 2026-11-11 晚。原来写在"空结果"分支里，结果被保底挡住，永远跑不到。
    try {
      const _ok = scored.slice(0, limit)
      const _weak = _ok.length > 0 && _ok.every((x) => {
        const w = Array.isArray(x.why) ? x.why.join(' ') : ''
        return w.includes('语义保底') || w.includes('直扫救回')
      })
      if (_weak && _ok[0] && _ok[0].p) {
        const target = _ok[0].p
        if (target.open !== true) {
          target.open = true
          try { backupSea(sea) } catch {}
          try { writeSea(sea, data) } catch {}
          try { audit('mark-open', { id: target.id, q: String(query || '').slice(0, 24), why: 'only-weak' }) } catch {}
        }
      }
    } catch {}

    // 长问句常输在标点上：问句里是空格，正文里是逗号，字面就撞不上，只好滑到语义。
    // 所以比字面前先把两边都洗成"只剩字"——标点、空格全去掉。
    // 2026-11-11 深夜，实测十二题错两道都是这个原因。
    try {
      const _flat = (s) => String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
      const _q = _flat(query)
      if (_q.length >= 8) {
        let _lit = 0
        for (const x of scored) {
          const _hay = _flat(x.p && x.p.title) + _flat(x.p && x.p.text).slice(0, 200)
          if (!_hay) continue
          if (_hay.includes(_q)) { x.why = [...(Array.isArray(x.why) ? x.why : []), '去标点字面']; _lit++ }
        }
        if (_lit) {
          // 命中的排前面，其余照旧
          scored.sort((a, b) => {
            const wa = (Array.isArray(a.why) ? a.why : []).join(' ')
            const wb = (Array.isArray(b.why) ? b.why : []).join(' ')
            const ca = wa.includes('去标点字面') ? 1 : 0
            const cb = wb.includes('去标点字面') ? 1 : 0
            return cb - ca
          })
        }
      }
    } catch {}

    // 问句常被改写：整串对不上，但碎片对得上。
    // 所以按"两字片段命中了几个"再排一次——命中多的往前，并列时保持原顺序。
    // 2026-11-11 深夜：十二题里错的两道，都是问句换了词、整串撞不上。
    try {
      const _q = String(query || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
      if ([..._q].length >= 8) {
        const grams = []
        for (let i = 0; i + 2 <= _q.length; i++) grams.push(_q.slice(i, i + 2))
        const score = new Map()
        for (const x of scored) {
          const hay = String((x.p && x.p.title) || '') + String((x.p && x.p.text) || '').slice(0, 300)
          let n = 0
          for (const g of grams) if (hay.includes(g)) n++
          score.set(x, n)
        }
        scored.sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0))
      }
    } catch {}

    // 出口兜底：不管中间哪道闸，整句字面对得上的必须先出现在结果里。
    // 为什么放在出口而不是闸上：里面的闸不止一道，改一处另一处还在拦；
    // 出口只有一处，这里补最省事、也最不容易漏。2026-11-11 深夜。
    try {
      const _flat2 = (s) => String(s || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
      const _qf = _flat2(query)
      if (_qf.length >= 6) {
        const _ids = new Set(scored.map((x) => String(x.p && x.p.id)))
        for (const _p2 of data.points) {
          if (_p2.dead || _p2.archived) continue
          if (_ids.has(String(_p2.id))) continue
          const _hay = _flat2(_p2.title) + _flat2(_p2.text).slice(0, 300)
          if (_hay.includes(_qf)) {
            scored.unshift({ p: _p2, hit: 1, rel: 1, score: 2, why: ['整句兜底'] })
            break
          }
        }
      }
    } catch {}

    // 按类别带：问句里出现"规矩/答应/忘了/是不是"这类词，说明他在问约束，
    // 就把标了规矩、标了承诺的条目直接并进结果——不靠切词也找得到。
    // 为什么放出口：前面有多条早退分支，放里面只会被绕过（今晚已经栽过一次）。
    try {
      if (/规矩|答应|说过|不能|必须|底线|原则|说好了|记牢|忘了|忘过/.test(String(query || ''))) {
        const _has = new Set(scored.map((x) => String(x.p && x.p.id)))
        for (const p3 of data.points) {
          if (p3.dead || p3.archived) continue
          if (_has.has(String(p3.id))) continue
          const cats = Array.isArray(p3.category) ? p3.category : []
          const isRule = p3.rule === true
          const isPromise = cats.includes('承诺') || cats.includes('规矩')
          if (!isRule && !isPromise) continue
          scored.push({ p: p3, hit: 1, rel: 0.5, score: isRule ? 0.95 : 0.9, why: [isRule ? '规矩类' : '承诺类'] })
        }
      }
    } catch {}

    // 重排：把「像但不对」的压下去。低档自己会跳过，不用这里判断。
    try { scored = rerank(scored, query) } catch {}

    const lines = scored.slice(0, limit).map((x) => {
      const p = x.p
      const body = String(p.text || '').replace(/\s+/g, ' ').slice(0, 110)
      const from = p._from ? '〈来自 ' + p._from + '〉' : ''
      const hitTxt = Number(x.hit) >= 1 ? Math.round(Number(x.hit)) : Number(x.hit).toFixed(2)
      // 为什么想起它——给模型一句理由，它才会真的用；给人一句理由，才看得出准不准
      let whyTxt = ''
      try {
        const ws = Array.isArray(x.why) && x.why.length ? x.why.slice(0, 3) : []
        if (ws.length) whyTxt = ' 〔' + ws.join(' · ') + '〕'
      } catch {}
      let markTxt = ''
      try { markTxt = markText(p) } catch {}
      // 写的时候就泛：露出来，别让"记得"和"写得实"混成一回事
      try { if (p.flat) markTxt += '〔这条当时写得泛〕' } catch {}
      return '· #' + p.id + ' ' + p.title + from + '（' + bornLabel(p) + '，命中 ' + hitTxt + '）' + markTxt + whyTxt + '\n  ' + body
    })
    // 顺手把这次检索记进审计
    try {
      audit('search', {
        sea, query: query.slice(0, 80), hits: scored.length,
        shown: Math.min(limit, scored.length),
      })
    } catch {}

    // 落一行检索日志。拿到的 logId 带回去，说错的时候能用它标注
    let logId = null
    try {
      logId = logSearch({
        sea,
        query,
        tier: ['low', 'high', 'max'][qualityRank() - 1] || '',
        limit,
        results: scored.slice(0, 8).map((x) => ({ id: x.p.id, title: x.p.title, score: x.score })),
        src: String((args && args.src) || 'tool'),
      })
    } catch (e) {
      // 记不下来别影响检索，但得留痕，不然永远不知道为什么 logId 是 null
      try { audit('searchlog-fail', { err: String((e && e.message) || e) }) } catch {}
    }

    // 遗忘痕迹：结果不实在的时候，去看看沉下去的那批。
    // 为什么要有：归档之后检索直接跳过，于是「记得但想不起来」和「从来没记过」一模一样。
    // 只补一句人话，不把条目翻出来——翻出来就等于没沉。2026-11-11 深夜。
    let _sunken = ''
    try {
      const _whyOf = (x) => (Array.isArray(x.why) ? x.why.join(' ') : '')
      const _weak = !scored.length || scored.every((x) => /语义保底|直扫救回/.test(_whyOf(x)))
      const _q = String(query || '').trim()
      if (_weak && [..._q].length >= 2) {
        const _arch = (data.points || []).filter((x) => x.archived && !x.dead
          && (String(x.title || '') + String(x.text || '')).includes(_q))
        if (_arch.length) {
          const _x = _arch.sort((a, b) => (Number(b.archivedAt) || 0) - (Number(a.archivedAt) || 0))[0]
          const _d = Math.max(1, Math.round((Date.now() - (Number(_x.archivedAt) || Date.now())) / 86400000))
          _sunken = '\n（这块我记着有过东西：「' + String(_x.title || '').slice(0, 24) + '」，' + _d + ' 天前沉下去了，细节没了）'
        }
      }
    } catch {}

    const _weakHint = !scored.length || scored.every((x) => {
      const w = Array.isArray(x.why) ? x.why.join(' ') : ''
      return /语义保底|直扫救回/.test(w)
    })

    return {
      ok: true,
      logId,
      log: '识海里跟「' + query + '」最像的 ' + Math.min(limit, scored.length) + ' 条：\n'
        + lines.join('\n') + bodyNote + vectorNote + _sunken
        // 结果虚的时候提醒标一次：没有标注，召回率永远算不出来。
        // 只在"全是保底"时加，正常命中不加——不然每轮都多一句噪音。2026-11-11 深夜。
        + (_weakHint
          ? '\n（这次是凑出来的。用上了就 memory_judge 标一下' + (logId ? '，logId=' + logId : '') + '；没对上就标 miss。）'
          : ''),
    }
  },
}

/**
 * memory_judge —— 给上一次检索打分
 *
 * 为什么要有这个工具：检索准不准，不能靠「感觉挺准」。
 * 得有人标：翻到了 / 没翻到 / 翻出来的是错的。
 * 标够 10 次，recall@k 才算得出来——在那之前，任何「准确率」都是编的。
 */
export const judgeTool = {
  name: 'memory_judge',
  description:
    '给刚才那次检索打分。翻到了就 hit，没翻到该有的就 miss，翻出来的是错的就 wrong。'
    + '这一步是标数据，不改记忆——攒够次数才能算出检索到底准不准。',
  parameters: {
    type: 'object',
    properties: {
      log_id: { type: 'string', description: 'memory_search 返回的 logId' },
      verdict: {
        type: 'string',
        enum: ['hit', 'miss', 'wrong'],
        description: 'hit=翻到了；miss=没翻到该有的；wrong=翻出来的是错的',
      },
      expect_id: { type: 'number', description: '如果知道该翻到哪条，填它的编号' },
      note: { type: 'string', description: '一句话说明，比如「他问的是视频那条，翻成打赌了」' },
    },
    required: ['log_id', 'verdict'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' }, log: { type: 'string' } },
    },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const id = String((args && args.log_id) || '').trim()
    if (!id) return { ok: false, log: '得给我 logId——就是 memory_search 返回的那个。' }
    const v = String((args && args.verdict) || '').trim()
    if (!['hit', 'miss', 'wrong'].includes(v)) {
      return { ok: false, log: 'verdict 只能是 hit / miss / wrong。' }
    }
    const ok = judgeSearch({
      logId: id,
      verdict: v,
      expectId: Number((args && args.expect_id) || 0) || null,
      note: String((args && args.note) || ''),
    })
    if (!ok) return { ok: false, log: '记不进去，可能是日志文件写不了。' }
    const says = { hit: '翻到了', miss: '没翻到', wrong: '翻错了' }[v]
    return {
      ok: true,
      log: '记下了：这次检索「' + says + '」。' + (v === 'hit' ? '' : '（这条会进误差统计）'),
    }
  },
}

export const analogyTool = {
  name: 'memory_analogy',
  description: '找「结构像」的记忆，不是内容像。用来回答「这事跟以前那件像不像」。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '从哪条记忆出发' },
      sea: { type: 'string', description: '哪个识海，默认 main' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const id = Number(args && args.id)
    if (!Number.isFinite(id)) return { ok: false, log: '要一个 id。' }
    const list = findAnalogy(id, data)
    if (!list || !list.length) return { ok: true, log: '找不到结构像的。' }
    return {
      ok: true,
      log: '跟 #' + id + ' 结构像的：\n'
        + list.map((x) => '· #' + x.id + ' ' + x.title + '（' + x.score + '）\n  ' + x.why).join('\n'),
    }
  },
}

export const storyTool = {
  name: 'memory_story',
  description: '她这一路。按时间把核心记忆串成一条线，不是一堆散点。',
  parameters: {
    type: 'object',
    properties: {
      sea: { type: 'string', description: '哪个识海，默认 main' },
      dream: { type: 'boolean', description: '要不要带上她做过的梦（默认不带，主线只有现实）' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const s = buildStoryline(data, { dream: !!(args && args.dream) })
    if (!s.items) return { ok: true, log: '还没有能串成线的记忆。' }
    return { ok: true, log: s.text + '\n\n（' + s.eras + ' 个阶段 · ' + s.items + ' 条主线）' }
  },
}

export const sedimentTool = {
  name: 'memory_sediment',
  description: '看哪些事该沉淀成一条认识了。同一件事在不同日子反复出现，就是人设的一部分。',
  parameters: {
    type: 'object',
    properties: {
      sea: { type: 'string', description: '哪个识海，默认 main' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const list = findSedimentCandidates(data)
    if (!list.length) return { ok: true, log: '暂时没有该沉淀的。' }
    return {
      ok: true,
      log: '该沉淀成认识的（' + list.length + ' 组）：\n'
        + list.map((x) => '· ' + x.hint + '（可信度 ' + x.confidence + '）\n'
          + '  例：' + x.titles.join(' / ')).join('\n'),
    }
  },
}

export const rhythmTool = {
  name: 'memory_rhythm',
  description: '按记忆的时间戳看他的作息，用来预判他什么时候会出现。',
  parameters: {
    type: 'object',
    properties: { sea: { type: 'string', description: '哪个识海，默认 main' } },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const r = predictRhythm(data)
    if (!r) return { ok: true, log: '记忆太少，还看不出作息。' }
    return { ok: true, log: r.summary + '\n' + r.note }
  },
}

export const traceTool = {
  name: 'memory_trace',
  description: '一条记忆的来龙去脉：什么时候记的、被想起过几次、跟谁连着、证据是哪句。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '哪条记忆' },
      sea: { type: 'string', description: '哪个识海，默认 main' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const id = Number(args && args.id)
    const p = (data.points || []).find((x) => x.id === id)
    if (!p) return { ok: false, log: '没有 #' + id + ' 这条。' }

    const now = Date.now()
    const born = Number(p.born) || now
    const days = Math.floor((now - born) / 86400000)
    const recalls = Number(p.recallCount) || 0
    const st = Number(p.strength) || 60

    // 连着谁
    const neighbors = []
    for (const e of (data.edges || [])) {
      if (e.a !== id && e.b !== id) continue
      const oid = e.a === id ? e.b : e.a
      const o = (data.points || []).find((x) => x.id === oid)
      if (!o) continue
      neighbors.push({ title: o.title, w: e.w, type: e.type || 'related' })
    }
    neighbors.sort((a, b) => (b.w || 0) - (a.w || 0))

    const lines = []
    lines.push('#' + id + ' ' + String(p.title || ''))
    lines.push('')
    lines.push('记于：' + fmtDay(born) + '（' + days + ' 天前）')
    lines.push('被想起：' + recalls + ' 次')
    const stg = stageOf(p)
    lines.push('强度：' + st.toFixed(0) + ' 天 · arousal ' + (p.arousal || 5) + '/10')
    lines.push('清晰度：' + stg.label + '（' + stg.r + '）' + (stg.canDetail ? ' · 细节还在' : ' · 只记得轮廓，别补细节'))
    lines.push('分层：' + (p.layer || 'experience'))
    if (p.validUntil) lines.push('状态：已失效（' + fmtDay(p.validUntil) + ' 被新的事实取代）')
    if (p.conflictWith && p.conflictWith.length) {
      lines.push('⚠ 跟 #' + p.conflictWith.join('、#') + ' 打架')
    }
    if (p.factKey) lines.push('事实键：' + p.factKey)
    lines.push('')
    lines.push('证据（原文）：')
    lines.push('  ' + String(p.evidence || p.text || '').slice(0, 200))
    if (p.herSide && p.herSide.felt) {
      lines.push('')
      lines.push('她当时：' + p.herSide.felt)
      if (p.herSide.regret) lines.push('后来后悔：' + p.herSide.regret)
    }
    if (neighbors.length) {
      lines.push('')
      lines.push('连着（' + neighbors.length + ' 根）：')
      for (const nb of neighbors.slice(0, 6)) {
        lines.push('  · ' + nb.title + '（' + nb.type + ' ' + (nb.w || 0).toFixed(2) + '）')
      }
    }
    return { ok: true, log: lines.join('\n') }
  },
}

export const askTool = {
  name: 'memory_ask',
  description: '她可以问他。看看现在这条消息值不值得回一句问话——不是被动答，是会追问。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '他刚说的那句话' },
      sea: { type: 'string', description: '哪个识海，默认 main' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const s = String((args && args.text) || '').trim()
    if (!s) return { ok: false, log: '要一句他刚说的话。' }
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }

    const hints = []
    // 1) 他累/难受，但没说原因 → 问一句
    if (/(累|难受|烦|撑不住|不想)/.test(s) && s.length < 20) {
      hints.push('问一句「怎么了」——他说得短，说明不想展开，但不问又像不在乎')
    }
    // 2) 他说「没事」但前面有情绪 → 问一句
    if (/(没事|还好|算了)/.test(s) && s.length < 12) {
      hints.push('他说「没事」的时候其实有事。问一句，但别逼')
    }
    // 3) 他连着几天提到同一个人 → 问一句
    try {
      const alive = (data.points || []).filter((p) => !p.dead)
      const days = new Set(
        alive.filter((p) => s.includes(String(p.title || '').slice(0, 2)))
          .map((p) => Math.floor((Number(p.born) || 0) / 86400000)),
      )
      if (days.size >= 2) hints.push('这事他提过不止一次了，可以问「你最近老提起这个」')
    } catch {}
    // 4) 他在给自己找台阶 → 别问，让他说
    if (/(随便|都行|无所谓|你决定)/.test(s)) {
      hints.push('不用问。他在退，这时候问会让他更退，先接住')
    }

    if (!hints.length) return { ok: true, log: '不用问。直接答。' }
    return { ok: true, log: hints.map((x) => '· ' + x).join('\n') }
  },
}

/**
 * memory_date —— 给一条记忆钉死真实时间
 *
 * 为什么要有这个：那 126 条的时间戳是导入时按 15 分钟一条编的，
 * 作息图、沉降判断、归档全依赖它。等于跑在假时间上。
 *
 * 你什么时候想起「这条其实是 11-02 晚上」，一句话就能钉死。
 * 钉过的不再算「估的」，作息图才开始有真点。
 */
export const dateTool = {
  name: 'memory_date',
  category: 'memory',
  description:
    '给一条记忆钉死真实发生时间。原来那个时间是导入时估的，钉过之后才算真时间。'
    + '作息图、沉降、归档都靠这个才准。'
    + '时间可以写「2026-11-02 22:30」，也可以写「11-02 晚上」（会补成 21:00）。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '记忆编号' },
      when: {
        type: 'string',
        description: '真实时间。支持：2026-11-02 / 11-02 / 11-02 22:30 / 11-02 晚上 / 11-02 凌晨 / 今天 / 昨天',
      },
      sea: { type: 'string', description: '哪个识海，不填就是 main' },
    },
    required: ['id', 'when'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const id = Number((args && args.id) || 0)
    if (!id) return { ok: false, log: '得给我记忆编号。' }
    const when = parseWhen(String((args && args.when) || ''))
    if (!when) {
      return {
        ok: false,
        log: '时间没看懂。可以写「2026-11-02」「11-02 22:30」「11-02 晚上」「11-02 凌晨」「今天」「昨天」。',
      }
    }

    const _lock = acquireWriteLock(sea, 2)
    if (!_lock) return { ok: false, log: '这个识海正在被别的窗口写，等几秒再试。' }
    try {
      const data = readSea(sea)
      if (!data || !Array.isArray(data.points)) return { ok: false, log: '读不到识海：' + sea }
      const p = data.points.find((x) => Number(x.id) === id)
      if (!p) return { ok: false, log: '没有编号 ' + id + ' 这条。' }
      if (p.dead) return { ok: false, log: '这条已经删了。' }

      const before = Number(p.born) || 0
      p.born = when
      p.bornEstimated = false
      p.bornFrom = 'user'
      p.bornSetAt = Date.now()
      backupSea(sea)
      const ok = writeSea(sea, data)
      if (!ok) return { ok: false, log: '写盘失败，没改。' }

      audit('date-set', { sea, id, from: before, to: when })
      const d = new Date(when)
      const pad = (n) => String(n).padStart(2, '0')
      const show = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      return {
        ok: true,
        log: '钉死了：#' + id + '「' + String(p.title || '').slice(0, 30) + '」→ ' + show
          + '（不再算估的）',
      }
    } catch (e) {
      return { ok: false, log: '改时间出错：' + String((e && e.message) || e) }
    } finally {
      try { _lock.release() } catch {}
    }
  },
}

/**
 * 把「11-02 晚上」这种说法转成毫秒时间戳。
 * 没写年份就按下一年到底的逻辑推：比现在还晚就当去年。
 * 写了时刻词就补成那个时段（凌晨 3 点、早上 8 点、上午 10 点、中午 12 点、
 * 下午 15 点、晚上 21 点、半夜 23 点）。
 */
function parseWhen(s) {
  const q = String(s || '').trim()
  if (!q) return null
  const now = new Date()
  const HOURS = [
    [/凌晨|半夜/, 3], [/早上|清早/, 8], [/上午/, 10],
    [/中午/, 12], [/下午/, 15], [/傍晚/, 18], [/晚上|夜里/, 21],
  ]
  let hour = null
  for (const [re, h] of HOURS) if (re.test(q)) { hour = h; break }

  // 今天 / 昨天
  if (/^今天/.test(q)) {
    const d = new Date(now)
    if (hour !== null) d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }
  if (/^昨天/.test(q)) {
    const d = new Date(now.getTime() - 86400000)
    if (hour !== null) d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }

  // 2026-11-02 / 2026/11/2 / 11-02 22:30
  const m = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(q)
  const m2 = /(?:^|\s)(\d{1,2})[-/月](\d{1,2})日?/.exec(q)
  const hm = /(\d{1,2}):(\d{2})/.exec(q)

  let y, mo, dy
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); dy = Number(m[3])
  } else if (m2) {
    mo = Number(m2[1]); dy = Number(m2[2])
    y = now.getFullYear()
    // 跨年：算出来的日子比现在还晚 30 天以上，就当去年
    const guess = new Date(y, mo - 1, dy)
    if (guess.getTime() - now.getTime() > 30 * 86400000) y -= 1
  } else {
    return null
  }
  if (!(mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31)) return null

  let h = 12, mi = 0
  if (hm) { h = Number(hm[1]); mi = Number(hm[2]) }
  else if (hour !== null) h = hour

  const d = new Date(y, mo - 1, dy, h, mi, 0, 0)
  if (Number.isNaN(d.getTime())) return null
  return d.getTime()
}

export const archiveTool = {
  name: 'memory_archive',
  description: '归档：把淡到想不起来的收起来。不进检索，但随时能捞回。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['sweep', 'list', 'restore', 'dry'],
        description: 'sweep=扫描并归档 / dry=只看看会归档哪些 / list=列出已归档 / restore=捞回来',
      },
      id: { type: 'number', description: 'restore 时要恢复哪条' },
      sea: { type: 'string', description: '哪个识海，默认 main' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const data = readSea(sea)
    if (!data) return { ok: false, log: '读不到识海：' + sea }
    const action = String(args && args.action || 'list')

    if (action === 'dry') {
      const would = sweepArchive(data, true)
      if (!would.length) return { ok: true, log: '没有该归档的。' }
      return {
        ok: true,
        log: '会归档 ' + would.length + ' 条：\n'
          + would.map((x) => '  #' + x.id + ' ' + x.title + '（亮度 ' + x.r + '）').join('\n'),
      }
    }

    if (action === 'sweep') {
      const moved = sweepArchive(data, false)
      if (!moved.length) return { ok: true, log: '没有该归档的。' }
      backupSea(sea)
      writeSea(sea, data)
      audit('archive', { sea, n: moved.length })
      return {
        ok: true,
        log: '归档了 ' + moved.length + ' 条（没删，随时能捞回）：\n'
          + moved.map((x) => '  #' + x.id + ' ' + x.title).join('\n'),
      }
    }

    if (action === 'list') {
      const arch = (data.points || []).filter((p) => p.archived && !p.dead)
      if (!arch.length) return { ok: true, log: '归档箱是空的。' }
      return {
        ok: true,
        log: '归档箱 ' + arch.length + ' 条：\n'
          + arch.map((p) => {
            const d = p.archivedAt ? Math.floor((Date.now() - p.archivedAt) / 86400000) : 0
            return '  #' + p.id + ' ' + String(p.title || '').slice(0, 26) + '（' + d + ' 天前收的）'
          }).join('\n'),
      }
    }

    if (action === 'restore') {
      const id = Number(args && args.id)
      if (!Number.isFinite(id)) return { ok: false, log: '要给我一个 id。' }
      const p = unarchive(data, id)
      if (!p) return { ok: false, log: '没有 #' + id + ' 这条。' }
      backupSea(sea)
      writeSea(sea, data)
      audit('unarchive', { sea, id })
      return { ok: true, log: '捞回来了：#' + id + ' ' + p.title + '\n（算重新碰了一次，亮度会涨）' }
    }

    return { ok: false, log: '不认识的动作：' + action }
  },
}

/**
 * 把刚生成的触屏版拷到桌面那份。
 *
 * 2026-11-08 查出来：renderTool 只跑 --touch，而 --touch 只写
 * ~/.dsh/consciousness-seas/意识海_触屏版.html，桌面那四份是当初手工拷的，
 * 00:51 之后再没动过——"自动更新"一直没真的连上。
 */
async function copyDesktop() {
  try {
    const { copyFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { homedir } = await import('node:os')
    const src = join(homedir(), '.dsh', 'consciousness-seas', '意识海_触屏版.html')
    if (!existsSync(src)) return '（没找到生成好的触屏版）'
    const desk = join(homedir(), 'Desktop')
    // 只更新主那份。另外三份是不同版式的历史产物，用同一份覆盖会把版式毁掉
    // （2026-11-08 我就这么干过一次，三份被覆盖成同一份，原样找不回来）。
    const targets = ['意识海.html']
    let n = 0
    for (const name of targets) {
      try { copyFileSync(src, join(desk, name)); n++ } catch {}
    }
    return `桌面副本已更新 ${n} 份`
  } catch (e) {
    return '拷桌面失败：' + String((e && e.message) || e)
  }
}

export const renderTool = {
  name: 'memory_render',
  description: '把识海重新导出一次（触屏版 + 桌面副本），页面数据没变就不用调。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute() {
    const _log = await run(['--touch'])
    const _cp = await copyDesktop()
    return { ok: true, log: _log + '\n' + _cp }
  },
}

/**
 * memory_count —— 自己数一遍
 *
 * 2026-11-08 加：这一晚我把工具数报了三个版本（13/15/18），前两个凭印象。
 * 答"我们有几个工具、几条路由、几份测试、库里多少点"之前，先调它。
 */
export const countTool = {
  name: 'memory_count',
  description: '自己数一遍：工具几个、路由几条、测试几份、识海几个、点几条、突触几根。'
    + '要报规模就先调它，别凭印象——2026-11-08 报错过两个版本。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute() {
    try {
      const { execFile } = await import('node:child_process')
      const path = await import('node:path')
      const url = await import('node:url')
      const here = path.dirname(url.fileURLToPath(import.meta.url))
      const script = path.join(here, '..', 'scripts', 'count.mjs')
      const out = await new Promise((resolve, reject) => {
        execFile(process.execPath, [script], { timeout: 20000 }, (err, stdout) => {
          if (err) reject(err); else resolve(stdout)
        })
      })
      return { ok: true, log: String(out).trim() }
    } catch (e) {
      return { ok: false, log: '数不动：' + String((e && e.message) || e).slice(0, 120) }
    }
  },
}

/**
 * 约定卡。
 *
 * 跟别的记忆不一样：约定不是「发生过的事」，是「欠着的事」。
 * 所以它有两样别的东西——谁答应的、兑现没有。
 *
 * 为什么单独做一类：经历会淡，承诺不能淡。
 * 「你说过要录 C 段」这话，一年后也得说得出来。
 */
export const promiseTool = {
  name: 'memory_promise',
  category: 'memory',
  description:
    '约定卡：谁答应了谁什么、兑现没有。约定不像经历会淡，它一直挂着直到兑现或作罢。'
    + 'action=add 记一条（要给 who 和 what），done 标记兑现，forget 标记作罢，list 看还欠着哪些。'
    + 'who：he=他答应我的，she=我答应他的。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'done', 'forget', 'list'] },
      who: { type: 'string', enum: ['he', 'she'], description: 'he=他答应的，she=我答应的' },
      what: { type: 'string', description: '约定内容，一句话' },
      dueAt: { type: 'string', description: '到期时间，可空。写法同 memory_date' },
      id: { type: 'number', description: 'done / forget 时要哪一条' },
      sea: { type: 'string', description: '哪个识海，不填就是 main' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    const action = String((args && args.action) || 'list').trim()

    // 看一眼：只读，不抢写锁
    if (action === 'list') {
      const data = readSea(sea)
      if (!data) return { ok: false, log: '读不到识海：' + sea }
      const open = (data.points || []).filter(
        (x) => !x.dead && String(x.kind || '') === 'promise' && String(x.promiseStatus || 'open') === 'open'
      )
      if (!open.length) return { ok: true, log: '没有还没兑现的约定。' }
      const now = Date.now()
      open.sort((a, b) => (Number(a.promiseDue) || 9e15) - (Number(b.promiseDue) || 9e15))
      const lines = ['还欠着的约定 ' + open.length + ' 条：']
      for (const x of open) {
        const made = Number(x.promiseMadeAt) || Number(x.born) || now
        const days = Math.max(0, Math.floor((now - made) / 86400000))
        const who = String(x.promiseWho || 'he') === 'he' ? '他答应：' : '我答应：'
        const due = Number(x.promiseDue) || 0
        let tail = '（' + days + ' 天前）'
        if (due) {
          const left = Math.floor((due - now) / 86400000)
          tail = left >= 0 ? '（还有 ' + left + ' 天到期）' : '（过期 ' + (-left) + ' 天）'
        }
        lines.push('· #' + x.id + ' ' + who + String(x.promiseWhat || x.text || '').trim() + tail)
      }
      return { ok: true, log: lines.join('\n') }
    }

    const _lock = acquireWriteLock(sea, 2)
    if (!_lock) return { ok: false, log: '这个识海正在被别的窗口写，等几秒再试。' }
    try {
      const data = readSea(sea)
      if (!data || !Array.isArray(data.points)) return { ok: false, log: '读不到识海：' + sea }
      const now = Date.now()

      if (action === 'add') {
        const what = String((args && args.what) || '').trim()
        if (!what) return { ok: false, log: '约定得写内容（what）。' }
        const who = String((args && args.who) || 'he').trim() === 'she' ? 'she' : 'he'
        const due = (args && args.dueAt) ? parseWhen(String(args.dueAt)) : 0
        const maxId = data.points.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0)
        const id = maxId + 1
        const p = {
          id,
          // 16 个字会把「录 GMod 第 1 集的 A/B/C/D 四段素材」切成「…的 A/」。
          // 实测库里就长着这么一条：他答应 · 录 GMod 第 1 集的 A/
          title: (who === 'he' ? '他答应 · ' : '我答应 · ')
            + (String(what || '').length > 26 ? String(what).slice(0, 26) + '…' : String(what || '')),
          titleFull: what,
          text: what,
          kind: 'promise',
          tag: '〔约〕',
          imp: 0.85,
          src: '约定卡',
          x: 0, y: 0, z: 0,
          era: 'dsh',
          born: now,
          bornEstimated: false,
          bornFrom: 'promise',
          lastSeen: now,
          polarity: 0,
          arousal: 5,
          category: ['约定'],
          entities: [],
          // 别人会这么问这条：写的时候顺手给一句，口语一问就能撞上
          alias: typeof args.alias === 'string' && args.alias.trim() ? args.alias.trim().slice(0, 60) : undefined,
          layer: 'core',
          emotion: {},
          target: null,
          validFrom: now,
          validUntil: null,
          factKey: null,
          evidence: what,
          confidence: 0.9,
          conflictWith: [],
          origin: 'user',
          recallCount: 0,
          strength: 60,
          open: true,
          promiseWho: who,
          promiseWhat: what,
          promiseStatus: 'open',
          promiseDue: due || null,
          promiseMadeAt: now,
        }
        data.points.push(p)
        backupSea(sea)
        const ok = writeSea(sea, data)
        if (!ok) return { ok: false, log: '写盘失败，约定没记上。' }
        try {
          const _n2 = await syncVectors(sea, data, 2)
          if (!_n2) audit('vector-miss-after-write', { sea, kind: 'promise' })
        } catch {}
        audit('promise-add', { sea, id, who, due: due || 0 })
        return {
          ok: true,
          log: '记下了 #' + id + '：' + (who === 'he' ? '他答应 ' : '我答应 ') + what
            + (due ? '，' + fmtDay(due) + ' 到期' : '')
            + '\n（约定不衰减，会一直挂在【还没兑现的约定】里。）',
        }
      }

      if (action === 'done' || action === 'forget') {
        const id = Number((args && args.id) || 0)
        if (!id) return { ok: false, log: '得给编号。不知道哪条就先 list。' }
        const p2 = data.points.find((x) => Number(x.id) === id)
        if (!p2) return { ok: false, log: '没有编号 ' + id + ' 这条。' }
        if (String(p2.kind || '') !== 'promise') return { ok: false, log: '#' + id + ' 不是约定卡。' }
        p2.promiseStatus = action === 'done' ? 'done' : 'forget'
        p2.promiseClosedAt = now
        p2.open = false
        p2.lastSeen = now
        backupSea(sea)
        const ok2 = writeSea(sea, data)
        if (!ok2) return { ok: false, log: '写盘失败，没改。' }
        audit('promise-close', { sea, id, how: action })
        return {
          ok: true,
          log: (action === 'done' ? '兑现了 #' : '作罢了 #') + id + '：' + String(p2.promiseWhat || p2.text || ''),
        }
      }

      return { ok: false, log: 'action 只认 add / done / forget / list。' }
    } finally {
      // 一定要放锁：release 是方法，不是函数本身
      try { _lock && _lock.release && _lock.release() } catch {}
    }
  },
}

/**
 * memory_sea：看看有哪些识海，或者开一个新的。
 * 之前她没有这只手——子智能体写一个新海，全被拒。
 */
export const seaTool = {
  name: 'memory_sea',
  description: '看看有哪些识海，或者开一个新的。往一个没建过的识海里写也会自动建。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'new'], description: 'list=看看有哪些；new=开一个新的' },
      name: { type: 'string', description: '新识海叫什么，一句话，别太长' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    const action = String((args && args.action) || 'list')
    if (action === 'list') {
      const out = []
      try {
        for (const name of readdirSync(SEAS_DIR)) {
          const f = join(SEAS_DIR, name, 'data.json')
          if (!existsSync(f)) continue
          let n = 0
          try { n = (JSON.parse(readFileSync(f, 'utf8')).points || []).filter((p) => !p.dead).length } catch {}
          let title = name
          try { const m = readMeta(name); if (m && m.name) title = m.name } catch {}
          out.push('· ' + title + '（' + name + '）' + n + ' 条')
        }
      } catch {}
      return { ok: true, log: out.length ? '现在有这些识海：\n' + out.join('\n') : '还没有识海。' }
    }
    if (action === 'new') {
      const nm = String((args && args.name) || '').trim()
      if (!nm) return { ok: false, log: '新识海得有个名字。' }
      const slug = nm.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 12)
      let id = slug || ('sea-' + Date.now().toString(36))
      let i = 1
      while (existsSync(join(SEAS_DIR, id, 'data.json'))) { id = slug + i++ }
      ensureSea(id, nm)
      return { ok: true, log: '建好了：' + nm + '（id=' + id + '）。往里写的时候 sea 填这个 id。' }
    }
    return { ok: false, log: '只认 list 或 new。' }
  },
}

/**
 * 合成：挑出该放在一起想的两条。
 *
 * 这是识海里唯一一个「产出新东西」的口子。检索是把旧的搬上来，
 * 合成是让两条旧的长出第三条——人就是这么想的。
 * 只给候选，不代写：模板拼出来的句子是废话，得由会写字的那层来写。
 */
export const synthTool = {
  name: 'memory_synthesize',
  category: 'memory',
  description: '挑出该放在一起想的两条记忆，看它们能拼出什么第三条。'
    + '不是检索——检索是搬旧账，这个是长新话。返回几组候选，每组带"为什么放一起"。',
  parameters: {
    type: 'object',
    properties: {
      sea: { type: 'string', description: '哪个识海，不填就是 main' },
      n: { type: 'number', description: '要几组，默认 5' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args) {
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const sea = String((args && args.sea) || 'main').replace(/[^\w\-]/g, '') || 'main'
      const n = Math.max(1, Math.min(12, Number(args && args.n) || 5))
      const file = path.join(process.env.USERPROFILE || '', '.dsh', 'consciousness-seas', sea, 'data.json')
      const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      const mod = await import('./synth.js')
      const pairs = mod.pickPairs(data.points || [], { n })
      if (!pairs.length) return { ok: true, log: '这会儿没找到值得放在一起的两条。' + '\n（库还小，或者都太像了——像到只能是同一件事。）' }
      const lines = pairs.map((x, i) => (i + 1) + '. ' + x.a.title + ' × ' + x.b.title + '\n  连着的是：' + x.why
        + '\n   A#' + x.a.id + '：' + x.a.text + '\n   B#' + x.b.id + '：' + x.b.text)
      return {
        ok: true,
        log: '该放在一起想的 ' + pairs.length + ' 组：\n\n' + lines.join('\n\n')
          + '\n\n（挑一组写出来，写成一条新的，标〔合成〕，别覆盖原来的。）',
      }
    } catch (e) {
      return { ok: false, log: '想不起来：' + String((e && e.message) || e).slice(0, 120) }
    }
  },
}

export const exportTool = {
  name: 'memory_export',
  description:
    '把识海里的记忆导成一批 Markdown 文件，存在用户目录的 .dsh/consciousness-mirror/<识海名>/ 下，'
    + '记事本能直接打开。用户说「把记忆导出来」「备份成文本」「我想自己看看记忆」时用这个。'
    + '导出的文件是只读的，在文件里改字不会影响识海。',
  parameters: {
    type: 'object',
    properties: {
      sea: { type: 'string', description: '哪个识海（id），不填就是 main' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args = {}) {
    const sea = (args && args.sea) || 'main'
    try {
      const { exportMirror } = await import('./mirror-export.js')
      const r = exportMirror(sea)
      if (!r.ok) return { ok: false, log: r.err || '导出失败' }
      return { ok: true, log: `导出了 ${r.n} 条，放在：${r.dir}\n（只用记事本就能翻；在里面改字不影响识海。）` }
    } catch (e) {
      return { ok: false, log: '导出出错：' + String((e && e.message) || e) }
    }
  },
}
