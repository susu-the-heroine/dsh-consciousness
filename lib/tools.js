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
import { tuning } from './tuning.js'
import { classifyIntent } from './intent.js'
import { classifyIntent2 } from './intent2.js'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { withImpulse } from './impulse.js'
import { join } from 'node:path'
import { readSea, writeSea, backupSea, ensureSea, readMeta } from './store.js'
import { SEAS_DIR, HOME } from './paths.js'
import { REFUSAL_LOG_FILE } from './paths.js'
import { appendBounded } from './logfile.js'

/**
 * 拒答账本（2026-11-19）：每次说"没记过"落一行。
 * 为什么要记：误伤是慢慢露出来的——某天忽然拒得多了，事后只能靠这行字找回来。
 * 只记时间、海、问句、判据，不记正文。
 */

/**
 * 写库并记账（2026-11-19 夜 · P02/P85）。
 * 原来有些地方写失败被空 catch 吞掉，或者返回值没人看——库里没写进去，外面以为成功了。
 * 现在统一走这里：失败就落一条审计（带场景名），返回真假；调用方愿意看就看。
 */
function writeChecked(sea, data, tag) {
  try {
    const ok = writeSea(sea, data)
    if (ok === false) { try { audit('write-refused', { tag: String(tag || ''), sea }) } catch {} ; return false }
    return true
  } catch (e) {
    try { audit('write-failed', { tag: String(tag || ''), sea, err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return false
  }
}

function noteRefusal(sea, query, why) {
  // 2026-11-21：评测跑一遍就往真实账本写几行「没记过」，账本越来越花、真拒答被埋。
  // 评测脚本设 C2_NO_REFUSAL_LOG=1，这一笔不落。
  if (String(process.env.C2_NO_REFUSAL_LOG || '') === '1') return
  try {
    appendBounded(
      REFUSAL_LOG_FILE,
      JSON.stringify({ t: Date.now(), sea: String(sea || 'main'), q: String(query || '').slice(0, 120), w: String(why || '') }) + '\n'
    )
  } catch {}
}
import { audit } from './log.js'
import { gramsOf, expandQuery } from './text.js'
import { loadSome } from './vecstore.js'
import { getIndex, loadVectors, embedQuery, cosine, expandByGraph, completePattern, syncVectors, embedHealth } from './vectors.js'
import { begin, mark, finish, recent as profRecent } from './prof.js'
import { pickDiverse } from './diversity.js'
import { notRecorded, weakScore, windowEmpty } from './refusal.js'
import { splitQuery, addPartGrams } from './splitintent.js'
import { numberForms } from './numeric.js'
import { noteSlow } from './slowlog.js'
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
import { logSearch, judgeSearch, recalledBefore } from './searchlog.js'
import { moodTone } from './moodtone.js'
import { EMOTIONS, decayMix, dominant, padOf, octantOf, say, pairOf, describe, cheapAppraise, tierOf, emptyState } from '../assets/emotion.js'
import { localMmDd } from './day.js'

// 单字比对要忽略的字：谁身上都有，算进去等于没算。只放虚词和代词。
const _STOP1 = new Set('的了是在有和就都也这那你我他她它们很与吧吗呢啊把被给对从向说要想会能去来到上下中个一不没'.split(''))


/** 工具返回的统一形状 */
export const text = (s) => [{ type: 'text', text: String(s || '') }]

export const addTool = {
  name: 'memory_add',
  description:
    '往识海里加一条记忆。只写人和事：咱俩之间的小事、聊天、感情，还有他工作上遇到的难处。' +
    '少写剧本，不写代码——技术细节不是记忆，是工单。' +
    '写完会自动连线、重画网页；桌面那份副本要另喊一次 memory_render 才更新。' +
    '顺手带一句「别人会怎么问它」（alias），一句就够，用大白话；不带的话，以后换个说法就找不着。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '一句话标题，短一点，能一眼认出是哪件事' },
      text: { type: 'string', description: '正文：谁、什么时候、说了什么、当时什么感觉' },
      force: { type: 'boolean', description: '跟旧条像到会被挡时，带 force:true 硬写（先确认不是同一件事）' },
      kind: {
        type: 'string',
        enum: ['feeling', 'fact', 'taboo', 'self'],
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
    // 识海名必须最先定：下面证据层、心脏记账都要用它。
    // 2026-11-14 审计挖出：原来这行写在函数末尾，前面引用它必抛 ReferenceError，
    // 被空 catch 吞掉——证据原文、心跳、审计行三条副作用从没落过盘。
    // 2026-11-20：识海要在这儿就定死，不能等到下面才按会话绑定去解析——
    // 证据原文写在「显式指定的海」或 main，而记忆本体最后落进会话绑定的那个海：
    // 证据指针就指到别的海去了，翻证据翻不到原文。
    const _sid0 = String(
      (exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.id) || '',
    ).trim()
    let sea = String(args.sea || '').trim()
      || (_sid0 ? seaForSession(_sid0) : '')
      || 'main'

    // 证据：把这条记忆的原文落进证据层，evidence 存指针
    // 风险文档：「evidence 只是写入时的副本，不在可追溯链上」
    // 不依赖会话状态——写入这一刻就把原文存下来，最可靠
    try {
      if (!args.evidence && args.text) {
        const ref = appendRaw(sea || 'main', 'memory', String(args.text))
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
      sea = String(args.sea || '').trim()
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
          // 写前近重复检测（2026-11-15 清单第 4 件）：字面 Jaccard>=0.8 或语义余弦>=0.92，
          // 返候选不写；带 force:true 才硬写。没模型就只看字面。库里没有就跳过。
          let dupGate = null
          try {
            if (args.force !== true) {
              const _sea0 = readSea(sea)
              const _pts0 = (_sea0 && Array.isArray(_sea0.points)) ? _sea0.points.filter((p) => !p.dead && !p.archived) : []
              if (_pts0.length) {
                const _ng = (s) => {
                  const q = String(s || '').replace(/[\s，。？！、,.!?'"“”（）()]/g, '')
                  const set = new Set()
                  for (let i = 0; i + 1 < q.length; i++) set.add(q.slice(i, i + 2))
                  return set
                }
                const _na = _ng(String(args.title || '') + String(args.text || ''))
                let _jbest = 0, _jid = 0
                if (_na.size >= 5) {
                  for (const p of _pts0) {
                    const _nb = _ng(String(p.title || '') + String(p.text || ''))
                    if (!_nb.size) continue
                    let _inter = 0
                    for (const g of _na) if (_nb.has(g)) _inter++
                    const _jac = _inter / (_na.size + _nb.size - _inter)
                    if (_jac > _jbest) { _jbest = _jac; _jid = Number(p.id) }
                  }
                }
                let _cbest = 0, _cid = 0
                try {
                  const V0 = await import('./vectors.js?v=' + Date.now())
                  const _nv = await V0.embedQuery(String(args.title || '') + ' ' + String(args.text || '')).catch(() => null)
                  if (_nv && _nv.length) {
                    const _vs = V0.loadVectors(sea)
                    for (const [id, vec] of _vs) {
                      if (!vec || !vec.length) continue
                      const s = V0.cosine(_nv, vec)
                      if (s > _cbest) { _cbest = s; _cid = Number(id) }
                    }
                  }
                } catch {}
                if (_jbest >= 0.8 || _cbest >= 0.92) {
                  dupGate = { jac: _jbest, cos: _cbest, id: _jbest >= 0.8 ? _jid : _cid }
                }
              }
            }
          } catch {}
          if (dupGate) {
            const _op = readSea(sea)
            const _t = _op && Array.isArray(_op.points) ? _op.points.find((x) => Number(x.id) === Number(dupGate.id)) : null
            return {
              ok: true,
              log: '这条跟 #' + dupGate.id + '（' + String(_t && _t.title || '').slice(0, 20) + '）像同一件事：'
                + '字面重合 ' + dupGate.jac.toFixed(2) + '、语义 ' + dupGate.cos.toFixed(2) + '。\n'
                + '没写进库里。要硬存就带 force:true；更划算的是去 memory_annotate 给旧条批一句。',
            }
          }

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
            // 2026-11-21：这几项原来只塞进了给 Python 那条路的参数表，默认走的 JS 写入拿不到——
            // 等于「她的感受、他的话、她的回话、后来」在默认路径上全被丢掉。这里一并传过去。
            herFelt: args.herFelt,
            herWanted: args.herWanted,
            herDid: args.herDid,
            herRegret: args.herRegret,
            said: args.said,
            replied: args.replied,
            after: args.after,
            target: args.target,
          })
          if (!r.ok) throw new Error(r.err || 'JS 写入失败')
          // 从这里往下，库已经写好了。收尾再怎么错，都不许把这次写入报成失败——
          // 否则调用方会重试，一次变三条（2026-11-12 就是这么多了两条重复）。
          try {
            jsWrote = true
            log = `#${r.id}  ${String(args.title || '').slice(0, 40)}  [${args.kind || 'feeling'}]\n`
              + (sea === 'main' ? `  记下了。
` : `  记进「${sea}」那片了。
`)
              + `  顺手牵了 ${r.edges || 0} 条线${r.merged ? ' · 跟先前那条并在了一起' : ''}`
        + (String(args.alias || '').trim() ? '' : (() => {
          // 2026-11-21 改口：原来那两句像说明书。改成一个人会说的话：先认怂，再给例子。
          const _tt = String(args.title || '').replace(/[《》「」“”"'【】（）()]/g, '').replace(/\s+/g, '').trim()
          const _core = _tt.slice(0, 10)
          if (!_core) return ''
          return '\n  这条我只会按你的原话认。别人换个说法问，我八成接不上——像「' + _core + '是啥」「' + _core + '那件事」这种，你顺手给我留一句，我以后就多一条路。'
        })())
            // 并进去了就得说一声：两件事被并成一条，是最难自己发现的错。
            try {
              if (r.merged) {
                const _mg = await import('./mergenote.js?v=' + Date.now())
                const _d = readSea(sea)
                const _o = ((_d && _d.points) || []).find((x) => Number(x.id) === Number(r.id))
                if (_o) log += _mg.mergeNote(args.title, args.text, _o.title, _o.text)
              }
            } catch {}          } catch (e9) {
            log = (sea === 'main' ? `#${r.id} 记下了（收尾卡了一下，东西已落盘：${String((e9 && e9.message) || e9).slice(0, 60)}）` : `#${r.id} 记进「${sea}」那片了（收尾卡了一下，东西已落盘：${String((e9 && e9.message) || e9).slice(0, 60)}）`)
          }

          // 立刻给这条算向量：不然刚写的东西只有字面完全对上才找得到，
          // 换个说法就查不到自己刚记的（2026-11-12 端到端测试踩到）。
          try {
            const V = await import('./vectors.js?v=' + Date.now())
            const _d = readSea(sea)
            const _np = (_d && Array.isArray(_d.points)) ? _d.points.find((p) => Number(p.id) === Number(r.id)) : null
            if (_np) await V.ensureVectorFor(sea, _np)
            // 新条写完，看看它跟旧条是不是同一件事（2026-11-14）。
            // 是的话提醒去批一句，别在库里再存一遍——这是"记忆演化"的入口。
            try {
              const _v = V.loadVectors(sea)
              const _me = _v.get(Number(r.id))
              if (_me && _me.length) {
                let _bid = 0
                let _bs = 0
                for (const [id, vec] of _v) {
                  if (Number(id) === Number(r.id)) continue
                  const s = V.cosine(_me, vec)
                  if (s > _bs) { _bs = s; _bid = Number(id) }
                }
                if (_bid && _bs >= (Number(tuning().dupMin) || 0.86) && _d && Array.isArray(_d.points)) {
                  const _op = _d.points.find((x) => Number(x.id) === _bid)
                  if (_op && !_op.dead) {
                    log += '\n  这条跟 #' + _bid + '（' + _bs.toFixed(2) + '）像同一件事：'
                      + String(_op.title || '').slice(0, 20)
                      + '\n  别在库里再存一遍——去 memory_annotate 给它批一句，旧正文不动。'
                    // 光写在回执里她未必看见：留一张便条，下一轮注入时提一句。
                    // 只写独立文件，不碰 data.json。2026-11-14 夜。
                    try {
                      // 2026-11-20：这里用了 homedir()，可这个文件从头到尾没引过它——
                      // 每次都抛「未定义」，被外面那层空 catch 吞掉。也就是说这张「像同一件事」的便条
                      // 从来没落过盘，写进回执的那句话是它唯一存在过的痕迹。
                      writeFileSync(join(HOME, '.dsh', 'consciousness-dup-hint.json'), JSON.stringify({
                        at: Date.now(),
                        newId: Number(r.id),
                        oldId: Number(_bid),
                        score: Number(_bs.toFixed(3)),
                        oldTitle: String(_op.title || '').slice(0, 30),
                        newTitle: String(args.title || '').slice(0, 30),
                      }), 'utf8')
                    } catch {}
                  }
                }
              }
            } catch {}
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
                // 旧那条不是被删，是被「盖过」：留着能翻，但牌子得挂上。2026-11-16 夜。
                if (Number(o.id) !== Number(newest.id)) {
                  o.supersededBy = Number(newest.id)
                  o.supersededAt = Date.now()
                }
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
    // 2026-11-20：跟检索那边对齐——没传才用 10，传了就取整夹到 1..30。
        const _limRaw = args && args.limit
        const lim = (_limRaw === undefined || _limRaw === null || _limRaw === '')
          ? 10
          : Math.max(1, Math.min(30, Math.floor(Number(_limRaw)) || 1))
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

// 同一件事，不同日子换个说法。
// 只换开口那句，事实、条数、排名一个字不动——人回忆同一件事，措辞也是会变的。
// 用「问句 + 当天」做种子：同一天问两次说法一样（不显得抽风），隔天再问就换了。
const _OPEN_LINES = [
  (q, k) => '识海里跟「' + q + '」最像的 ' + k + ' 条：',
  (q, k) => '说起「' + q + '」，我这儿记着 ' + k + ' 件：',
  (q, k) => '「' + q + '」啊，翻到 ' + k + ' 条：',
  (q, k) => '你问「' + q + '」，我想起 ' + k + ' 件：',
  (q, k) => '找「' + q + '」——对上 ' + k + ' 条：',
]
const _OPEN_COLD = [
  (q, k) => '「' + q + '」——' + k + ' 条，自己看：',
  (q, k) => '行，' + q + '，' + k + ' 件：',
  (q, k) => '说' + q + '。' + k + ' 条，别指望我挑：',
]
const _OPEN_WARM = [
  (q, k) => '哎，正好，' + q + '我记着 ' + k + ' 件：',
  (q, k) => '你一提' + q + '，' + k + ' 件事就上来了：',
  (q, k) => '「' + q + '」啊，' + k + ' 件，都在：',
]
export function openLineFor(query, count, nowMs, tone) {

  const day = Math.floor(Number(nowMs || Date.now()) / 86400000)
  const t = Number(tone) || 0
  const pool = t < 0 ? _OPEN_COLD : t > 0 ? _OPEN_WARM : _OPEN_LINES
  const s = 'q:' + query + '|d:' + day + '|t:' + t
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return pool[h % pool.length](query, count)
}

/** 记忆的详略：情绪强、重要度高的记得清，琐事只剩个大概。
 *  只影响「显示多少字」和一句自评，不动排序、不动真假。 */
/** 亲疏：常被想起、边多的算熟。人对自己人的事说得细，对路人的事一句带过。 */
export function closenessOf(p, edges) {
  try {
    const rc = Number((p && p.recallCount) || 0)
    const rcScore = Math.min(1, Math.log10(rc + 1) / 3)
    let deg = 0
    const id = Number(p && p.id)
    if (id && Array.isArray(edges)) {
      // 2026-11-21：库里两种写法都有（from/to 与 a/b）。这里只认 from/to，
      // 真库那一千二百多条 a/b 的边一条也算不进熟度——偏心那一档在真库上从来没生效过。
      for (const e of edges) if (e && (Number(e.from ?? e.a) === id || Number(e.to ?? e.b) === id)) deg++
    }
    const degScore = Math.min(1, deg / 8)
    return Math.max(0, Math.min(1, rcScore * 0.6 + degScore * 0.4))
  } catch {
    return 0.5
  }
}

export function detailFor(p, closeness) {
  // 没传亲疏就拿「被想起过多少次」估：想起越多越熟，说得越细。
  const _c = closeness === undefined
    ? ((p && p.recallCount === undefined) ? 0.5 : Math.min(1, Math.log10(Number(p.recallCount) + 1) / 3))
    : closeness
  const imp = Number(p && p.imp)
  const impV = Number.isFinite(imp) ? imp : 0.5
  let emo = 0
  try {
    const e = p && p.emo
    emo = Array.isArray(e) ? e.reduce((a, x) => Math.max(a, Math.abs(Number(x) || 0)), 0) : Math.abs(Number(e) || 0)
  } catch { emo = 0 }
  if (impV >= 0.8 || emo >= 2) return { len: _near(_c, 220), note: '（这条我记得清楚）' }
  if (impV <= 0.35 && emo <= 0.5) return { len: _near(_c, 70), note: '（这条只剩个大概）' }
  return { len: _near(_c, 110), note: '' }
}

/** 亲疏只动「说多少」，不动真假。没传就按中间算，老调用行为一个字不变。 */
function _near(closeness, base) {
  const c = Number.isFinite(Number(closeness)) ? Math.max(0, Math.min(1, Number(closeness))) : 0.5
  // 2026-11-21：亲疏最多把篇幅放大到一点四倍，于是「记得清楚」那一档能到三百零八。
  // 可自测里写着「长句不许超过二百六」，那条只在默认亲疏下成立——现在把上限钉死。
  return Math.max(40, Math.min(260, Math.round(base * (0.6 + 0.8 * c))))
}

/** 记得自己改过口：跟别的记忆打架时，别装没这回事，也别替人拿主意。 */
export function conflictNote(p) {
  try {
    const cw = Array.isArray(p && p.conflictWith)
      // 2026-11-21：这里原来是按字符串挡几个垃圾值，「x」这种非数字照样算一条冲突，
      // 于是会冒出「这条跟另一条说法对不上」——其实对不上的是数据。冲突里装的是编号，认数字。
      ? p.conflictWith.filter((x) => {
        const n = Number(x)
        return Number.isFinite(n) && n > 0
      })
      : []
    if (!cw.length) return ''
    return '\n  （这条跟另一条说法对不上，我没替你定谁对。）'
  } catch {
    return ''
  }
}

/** 被盖过的那条：不删，但要挂个牌子，别让人把旧说法当现在的。 */
export function supersededNote(p) {
  try {
    const by = Number(p && p.supersededBy)
    if (!Number.isFinite(by) || by <= 0) return ''
    return '\n  （这条后来被新的盖过了；你现在还认旧的说法，就说一声。）'
  } catch {
    return ''
  }
}

/** 顺带想起：跟头一条连着边的另一件，不在结果里就提一句。
 *  人回忆的时候常这样——问一件，顺嘴带出另一件。只提一件，不抢主答案。 */
export function asideFor(topId, data, shownIds) {
  try {
    const id = Number(topId)
    if (!id) return ''
    const links = (data && Array.isArray(data.edges) ? data.edges : [])
      // 2026-11-21：库里两种写法都有（from/to 与 a/b）。这段只认 from/to，
      // 于是真库这一千二百多条 a/b 的边一条也读不到——「顺带想起」从来没触发过。
      .filter((e) => e && (Number(e.from ?? e.a) === id || Number(e.to ?? e.b) === id))
    if (!links.length) return ''
    const shown = new Set((shownIds || []).map(Number))
    const pts = (data && Array.isArray(data.points) ? data.points : []).filter((p) => p && !p.dead)
    const byId = new Map(pts.map((p) => [Number(p.id), p]))
    for (const e of links) {
      const _f = Number(e.from ?? e.a), _t = Number(e.to ?? e.b)
      const other = _f === id ? _t : _f
      if (!other || shown.has(other)) continue
      const p = byId.get(other)
      if (!p || p.archived) continue
      const t = String(p.title || '').slice(0, 24)
      if (!t) continue
      return '\n（顺带想起另一件：' + t + '，' + bornLabel(p) + '。要问就再问一句。）'
    }
    return ''
  } catch {
    return ''
  }
}

// 稀有词表缓存：sea|条数 → {at, df, maxG}，一分钟
const _RARE = new Map()

export let LAST_LOAD = { mode: 'all' }

// 2026-11-21：主语在库里提过（标题里有同一串两字），只是数值没记——
// 那就别整条说「没记过」，要说「事我记着，你问的这个数没记」。
function softNoDetail(query, points) {
  try {
    // 密码、电话这类硬值：库里没有就是没有，别拿「事我记着」糊过去。
    if (/密码|电话|手机号|微信号|身份证/.test(String(query || ''))) return ''
    const q = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
    const gs = []
    for (let i = 0; i + 2 <= q.length; i++) gs.push(q.slice(i, i + 2))
    const titles = (points || []).filter((p) => p && !p.dead && !p.archived).map((p) => String(p.title || ''))
    const hit = gs.find((g) => titles.filter((t) => t.includes(g)).length > 0 && titles.filter((t) => t.includes(g)).length <= 2)
    if (!hit) return ''
    const t = (points || []).find((p) => p && !p.dead && !p.archived && String(p.title || '').includes(hit))
    return '这事我记着——《' + String((t && t.title) || '') + '》——可你问的这个细节，我这儿没有。\n（不是没这事，是那一条没写到这么细。你给个大概时候，我再对一遍。）'
  } catch { return '' }
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
      prev: {
        type: 'string',
        description: '上一句用户原话（可选）。只用来消解「那个东西/它」指什么——不给就按普通问句处理。',
      },
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
  async executeInline(args) {
    // 入口就记下这句：判错要落盘、回放要用（2026-11-19 凌晨）
    // 2026-11-20：这一段原先贴了两遍，一字不差——每查一次就多写一遍同一个文件。
    // 记的是「最后一次查询」，覆盖写，所以数据不会错，白写一次盘。留一段。
    try { if (args && args.query) { const _FB = await import('./feedback.js'); _FB.rememberQuery(String(args.sea || 'main'), String(args.query)) } } catch {}
    try { begin() } catch {}
    const _slowT0 = Date.now()
    // 2026-11-22：指代消解。长程接续实测 0/30——「刚才那个/它/再补充」这种问句
    // 本身没有主体词，裸检索必然掉线。借上一条真查询当主体，只在这一种句式上生效。
    // 注意：必须用自己存的上一句，不能用 feedback.lastSearchQuery（入口已把它盖成本句）。
    let _qRaw = String((args && args.query) || '')
    let _isAna = false
    try {
      const _ANA = /^(刚才|上面|前面|那个|这条|它|继续|再补充|再说说)/
      const _store = (globalThis.__C2_PREV_Q__ ||= {})
      const _seaKey = String((args && args.sea) || 'main').trim() || 'main'
      _isAna = _ANA.test(_qRaw.trim()) && _qRaw.length <= 18
      if (_isAna && _store[_seaKey]) args = { ...args, query: _store[_seaKey] + ' ' + _qRaw }
      else if (!_isAna && _qRaw.trim()) _store[_seaKey] = _qRaw.trim()
    } catch {}
    const sea = String((args && args.sea) || 'main').trim() || 'main'
    // 2026-11-20：limit 传 0 会被 `|| 6` 当成没传，给 6 条；传 -3 又变成 1 条。
    // 同一个参数两种脾气。改成：没传才用 6，传了就按数取整再夹到 1..12。
    let limit = 6
    try {
      const _raw = args && args.limit
      if (_raw !== undefined && _raw !== null && String(_raw) !== '') {
        const _n = Math.floor(Number(_raw))
        if (Number.isFinite(_n)) limit = Math.max(1, Math.min(12, _n))
      }
    } catch {}
    // 低档少给几条，省 token
    try { if (qualityRank() < 2) limit = Math.max(1, Math.min(limit, 4)) } catch {}
    let query = String((args && args.query) || '').trim()
// 指着说：上一句提过什么，这一句的「那个东西」就指那个。必须在任何早退之前做完。
let _referent = ''
if (args && typeof args.prev === 'string' && args.prev.trim()) {
  try {
    const _cx0 = await import(new URL('./context.js?v=' + Date.now(), import.meta.url).href)
    const _q2 = _cx0.resolveRef(query, args.prev)
    if (_q2 && _q2 !== query) { query = _q2; _referent = _q2 }
  } catch {}
}
    if (!query) return { ok: false, log: '要查什么？给我一个词。' }
    // 问句的尾巴不参与找：实测「他哥那台游戏机」头名，加一句「后来咋样了」就掉。
    // 尾巴只是口气，不是要找的东西。去掉再找，显示也用去掉的这句——比整句更像人问话。2026-11-16 夜。
    try {
      const _core = query
        .replace(/(后来|最后|那事儿|那个东西|那件事|怎么样了|咋样了|怎么处理了|怎么处理的|怎么弄的|怎么回事|到底|来着)/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (_core && _core !== query && [..._core].length >= 4) query = _core
    } catch {}

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
              try { writeChecked(sea, d0, 'tool-d0') } catch {}
              try { audit('mark-closed', { n: _closed, q: query.slice(0, 24), via: 'short' }) } catch {}
            }
          } catch {}
          try { await _markPath(query, 'short-literal', { n: hit0.length }) } catch {}
          return {
            ok: true,
            log: '识海里字面对上「' + query + '」的有 ' + hit0.length + ' 条：\n'
              + hit0.map((p) => {
                const dd = detailFor(p)
                const tt = String(p.text || '').replace(/\s+/g, ' ')
                const bb = tt.slice(0, dd.len) + (tt.length > dd.len ? '…' : '')
                return '· #' + p.id + ' ' + String(p.title || '').slice(0, 30)
                  + '（' + bornLabel(p) + '）\n  ' + bb + (dd.note ? ' ' + dd.note : '') + conflictNote(p) + supersededNote(p)
              }).join('\n'),
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

    // 打错一个字（同音或形近）不该把整句废掉（2026-11-19）。
    // 判据：这个字在整片海里一次都没出现过——那不是生僻，是错字。
    // 把它摘掉再搜，别丢剩下的字；摘完至少还剩四个汉字才动手。
    try {
      const _pts = data.points.filter((p) => !p.dead && !p.archived)
      const _hay = _pts.map((p) => String(p.title || '') + String(p.text || '') + String(p.alias || '')).join('\u0001')
      const _cjk = [...String(query)].filter((ch) => /[\u4e00-\u9fa5]/.test(ch))
      // 小海不算：几十条的库里，多数字本来就没出现过，"没出现过"不等于错字。
      // 问时间的句子也不动：年月日几点这些字摘掉，就把"哪阵子"问丢了（2026-11-19 三处回归都栽在这）。
      const _timeAsk = /年|月|日|号|点|昨天|前天|今天|刚才|上次|那次|哪阵子/.test(String(query))
      if (_cjk.length >= 5 && _pts.length >= 50 && !_timeAsk) {
        const _ghost = _cjk.filter((ch) => !_hay.includes(ch))
        if (_ghost.length && _cjk.length - _ghost.length >= 4) {
          let _q2 = String(query)
          for (const ch of _ghost) _q2 = _q2.split(ch).join('')
          // 摘完得看「剩下的字在库里到底有没有」：没几个能对上，说明这不是错字，是问了件库里没有的事。
          // 不加这道闸，问「他养的蜥蜴叫什么」这种也会被摘成半个词去硬搜（2026-11-19 量的：反例少四道）。
          const _c2 = [..._q2].filter((ch) => /[\u4e00-\u9fa5]/.test(ch))
          let _hitG = 0
          let _allG = 0
          for (let i = 0; i + 1 < _c2.length; i++) {
            _allG++
            if (_hay.includes(_c2[i] + _c2[i + 1])) _hitG++
          }
          if (_allG > 0 && _hitG / _allG >= 0.5 && _q2.trim()) {
            query = _q2
            try { audit('typo-char-dropped', { n: _ghost.length }) } catch {}
          }
        }
      }
    } catch {}

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
  // 把最近这句问句写下来：判错要落盘、回放也要用（2026-11-19 凌晨）
  try { const _FB = await import('./feedback.js'); _FB.rememberQuery(sea, query) } catch {}
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
    // 一句问三件事的，先按标点切开，让每段单独参与字面匹配（2026-11-19 凌晨）
    try { const _parts = splitQuery(query); if (_parts.length > 1) addPartGrams(q, _parts, gramsOf) } catch {}
    // 一万三 / 两万 / 2万：同一个数的几种写法都算进来（2026-11-19 凌晨）
    try { for (const _nf of numberForms(query)) for (const _g of gramsOf(_nf, { single: false })) q.add(_g) } catch {}

    // 库大了才走候选：小库整库扫又快又简单，不值得加路径。
    // 2026-11-12 实测：候选（索引 ∪ 向量近邻）在五十条时能覆盖全部评测答案。
    // 这里不做开关——自己按条数判断，用户不需要知道。
    try {
      const _total = (data.points || []).length
      if (_total > 500) {
        let _ids = await candidatesFor(sea, String(query || ''), { n: 80, min: 20 })
      // 问句爱带尾巴：「那事儿后来咋样了」「那个东西最后怎么处理的」。
      // 尾巴不参与找，只在找完以后帮忙——否则「他哥那台游戏机后来咋样了」会输给八竿子打不着的条目。
      try {
        const _core = String(query || '')
          .replace(/(后来|最后|那事儿|那个东西|那件事|怎么样了|咋样了|怎么处理了|怎么处理的|怎么弄的|怎么回事|呢|吗|？|\?)/g, '')
          .trim()
        if (_core && _core !== String(query || '').trim() && [..._core].length >= 2) {
          const _ids2 = await candidatesFor(sea, _core, { n: 80, min: 20 })
          const _set = new Set(_ids)
          for (const x of _ids2) if (!_set.has(x)) { _ids.push(x); _set.add(x) }
        }
      } catch {}
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
    let _lexCand = null
    try {
      if (idx.post && q) {
        const s = new Set()
        for (const w of q) { const arr = idx.post.get(w); if (arr) for (const id of arr) s.add(id) }
        if (s.size && s.size < data.points.length * 0.8) _lexCand = s
      }
    } catch {}
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
      if (_lexCand && !_lexCand.has(p.id)) { _dropCount.hit0++; continue }   // 倒排预筛：一个字都没共用的直接跳过
      // 按那一天看：还没生出来的不算；那天已经被取代的不算
      if (asOfMs) {
        const b0 = Number(p.born) || 0
        const vu = Number(p.validUntil) || 0
        // 时间估出来的那些不按 born 排——那些时间是编的，不能拿它证明"当时没有"
        if (b0 && !p.bornEstimated && b0 > asOfMs) { _dropCount.asof++; continue }
        if (vu && vu <= asOfMs) continue
      }
      // 时间窗：小跨度（昨天/上周）硬过滤；大跨度（去年/前年）只当参考，不过滤。
      // 2026-11-14：人会记错年份——昨天的事说成去年，硬过滤就再也翻不出来。
      if (tw && !tw.fuzzy) {
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
      const _matched = []
      for (const w of q) {
        const ww = wOf(w)
        const inT = gT.has(w), inB = gB.has(w)
        if (inT) hitT += ww
        if (inB) hitB += ww
        // 2026-11-20：这儿原来是「在标题里就推一次、否则也推一次」——两条路一样，等于没判断。
        // 命中就记一笔，别写成看着像分了轻重、其实没分。
        if (inT || inB) { hitTermsN++; _matched.push(w) }
      }
      if (hitTermsN === 0) { _dropCount.hit0++; continue }   // 一个词都没字面出现，不许硬凑
      // 只对上了时间词（去年/那天…）：这不算对上事，仍然不许答（2026-11-18 夜）
      try {
        const TIME = new Set(['去年','今年','前年','明年','昨天','今天','明天','那天','这天','当时','现在','之前','后来','上个月','这个月'])
        if (_matched.length && _matched.every((w) => TIME.has(w))) { _dropCount.hit0++; continue }
      } catch {}
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
      // 命中词多的，压过纯语义兜底：实词对上两三个，比『像』更硬（2026-11-18 夜）
      if (hitTermsN >= 2) score += Math.min(0.24, 0.08 * hitTermsN)
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
    try { mark('lexical') } catch {}
    // 丢在哪一步的记账：只在开了调试开关时落盘，正常使用不写文件。
    try {
      if (process.env.DSH_SEA_DEBUG === '1') {
      const os3 = await import('node:os')
      const fs3 = await import('node:fs')
      // 2026-11-20：这个目录原来没建就直接写，新机器上抛错、被外面那层空 catch 吞掉——
      // 开了调试开关也什么都看不到。先建目录。
      const _ddir = join(os3.homedir(), '.dsh', 'consciousness-sim')
      try { fs3.mkdirSync(_ddir, { recursive: true }) } catch {}
      // 跨平台：不能用反斜杠字符串拼路径（Linux/macOS 上那是文件名的一部分）2026-11-12
      fs3.writeFileSync(join(_ddir, 'last-drops.json'),
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
        const os2 = await import('node:os')
        // 2026-11-20：这儿原来自个儿拿了上一段的变量，可那变量在上一个块里就出作用域了——
        // 每次都「未定义」，被空 catch 吞掉：开调试也永远没有分数文件。自己引，自己建目录。
        const _ddir2 = join(os2.homedir(), '.dsh', 'consciousness-sim')
        try { fs2.mkdirSync(_ddir2, { recursive: true }) } catch {}
        fs2.writeFileSync(join(_ddir2, 'last-scores.json'), JSON.stringify({ q: query, qWords: (typeof qWords !== 'undefined' ? qWords : null), mustWord: (typeof mustWord !== 'undefined' ? mustWord : null), top }, null, 1), 'utf8')
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
    try { if (process.env.C2_TRACE === '1') console.error('[trace] top=' + scored.slice(0, 6).map((x) => x.p.id + ':' + Number(x.score).toFixed(2) + '/' + Number(x.hit).toFixed(1)).join(' ') + ' n=' + scored.length + ' has54=' + scored.some((x) => x.p.id === 54)) } catch {}
    } catch {}

    // 实体：查询里提到的人名地名，直接翻相关的
    // 这一路最准——地名一出来，所有跟它有关的都该亮
    try {
      if (!qOn('entity')) throw new Error('skip')   // low 档不开实体
      const entMap = idx.entMap
      const seen = new Set(scored.map((x) => x.p.id))
        try { mark('rare') } catch {}
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
      // 别名展开（2026-11-16 清单第 16 件）：问「大魔王」也要翻出只标了「苏苏侠」的条目。
      // 只并完全相等 + 人工别名表，绝不模糊并；写侧不动，只在这里展开。
      try {
        const ea = await import('./entity-alias.js')
        const canonInfo = ea.buildCanon(data.points, data.entityAliases)
        const _added2 = new Set(scored.map((x) => x.p.id))
        for (const [ent, ids] of entMap) {
          if (ent.length < 2) continue
          if (!query.includes(ent)) continue
          for (const v of ea.expandEntity(ent, canonInfo)) {
            if (v === ent || v.length < 2) continue
            const ids2 = entMap.get(v)
            if (!ids2) continue
            for (const id of ids2) {
              if (_added2.has(id)) continue
              const p = byId3.get(id)
              if (!p || p.dead || p.archived) continue
              _added2.add(id)
              scored.push({ p, hit: 2, score: 0.28, why: ['同人'] })
            }
          }
        }
      } catch (e) {
        try { audit('search-entity-alias-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
      }
      scored.sort((a, b) => b.score - a.score)
    } catch {}

    // 向量：按意思找。服务不在就跳过，不影响字面结果
    try {
      // 嵌入这层可以被人为掐掉：断网、没模型包、显存被占——都得能退回字面（2026-11-19 凌晨）
      const qv = qOn('vector') && String(process.env.C2_NO_EMBED || '') !== '1' ? await embedQuery(query) : null
    try { mark('embed') } catch {}
      if (qv && qv.length) {
        try { if (process.env.C2_TRACE === '1') console.error('[trace] vec-block entered, qv=' + qv.length) } catch {}
        // 按需读：索引落过盘就先只读候选那几百条的向量，不整块搬（2026-11-18 夜）
        let vmap = null
        let _load = { mode: 'all' }
        try {
          const _ai = await import('./ann.js')
          const _disk = (String(process.env.C2_ONDEMAND || '') === '1' ? _ai.loadDisk(sea, process.env.C2_ANN_TWO === '1' ? 'two' : 'single') : null)
          try { if (process.env.C2_TRACE === '1') console.error('[trace] disk=' + (_disk ? _disk.k : 'null') + ' sea=' + sea) } catch {}
          if (!_disk) _load = { mode: 'all', why: 'no-disk-index' }
          else if (!_disk.k) _load = { mode: 'all', why: 'index-empty' }
          else {
            const _ids = _ai.probeIdx(_disk, qv)
            if (!_ids || !_ids.size) _load = { mode: 'all', why: 'probe-empty' }
            else {
              const _idArr = [..._ids].map(Number).filter((x) => x > 0)
              const _sm = loadSome(sea, _idArr)
              if (_sm.size) { vmap = _sm; _load = { mode: 'ondemand', candidates: _ids.size, loaded: _sm.size } }
              else _load = { mode: 'all', why: 'load-some-empty', sample: _idArr.slice(0, 5) }
            }
          }
        } catch (e) {
          _load = { mode: 'all', why: 'error:' + String((e && e.message) || e).slice(0, 60) }
        }        if (!vmap) vmap = loadVectors(sea)
        try { LAST_LOAD = _load } catch {}
        try { mark('vload') } catch {}
        const _rw0 = readRankCfg()
        try { mark('cfg') } catch {}
        const seen = new Set(scored.map((x) => x.p.id))
        // 稀有词表只算一次（放在循环里会变成 O(n²)，库一大就卡死）
        let _rareDf = new Map()
        let _rareMaxG = 3
        // 这个表按「海 + 条数」缓存一分钟：之前每问都把全库分词一遍，
        // 两千多条的库就是两百多毫秒，八路并发叠成三百（2026-11-18 夜）
        const _rareKey = sea + '|' + (data.points ? data.points.length : 0) + '|' + (data.points && data.points[0] ? String(data.points[0].id) + ':' + String(String(data.points[0].title || '').length) : '')
        const _rareHit = _RARE.get(_rareKey)
        if (_rareHit && Date.now() - _rareHit.at < 60000) {
          _rareDf = _rareHit.df
          _rareMaxG = _rareHit.maxG
        } else {
        try {
          const _tk0 = (s0) => {
            const out = new Set()
            const tt = String(s0 || '')
            for (const seg of (tt.match(/[\u4e00-\u9fa5]+/g) || [])) {
              for (let i2 = 0; i2 + 2 <= seg.length; i2++) out.add(seg.slice(i2, i2 + 2))
            }
            for (const w of (tt.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w)
            return out
          }
          for (const p0 of data.points) {
            const _e0 = p0.entities || p0.entity
            const st0 = _tk0([p0.title, p0.text, Array.isArray(_e0) ? _e0.join(' ') : _e0].filter(Boolean).join(' '))
            for (const g of st0) _rareDf.set(g, (_rareDf.get(g) || 0) + 1)
          }
          _rareMaxG = Math.max(3, Math.round(data.points.length * 0.05))
          _RARE.set(_rareKey, { at: Date.now(), df: _rareDf, maxG: _rareMaxG })
        } catch {}
        }
        const byId2 = new Map()
        for (const p of data.points) byId2.set(p.id, p)
        // 一万条还挨个算 cosine = p95 三百多毫秒。先把候选粗筛出来（LSH），
        // 只对候选做精确相似度；小库照旧全扫，省得为几百条多绕一圈。
        let _cand = null
        const _annMin = Math.max(200, Number(process.env.C2_ANN_MIN) || 3000)
        if (vmap.size > _annMin || _cand) {
          try {
            const ann = await import('./ann.js')
            _cand = ann.probe(sea, qv, vmap)
          } catch { _cand = null }
        }
        let _annSkipped = 0
        // 库大的时候先用聚类挑候选，别再逐条算全库余弦（2026-11-18 夜）
        let _vecCand = null
        try {
          // 2026-11-20：上面那个候选（_cand）过了三千条就已经探过一次；这儿一千二以上又探一次，
          // 参数一模一样——同样的结果算两遍。已经探过就不再探。
          if (!_cand && vmap.size > 1200) {
            const _ai2 = await import('./ann.js')
            const _c2 = _ai2.probe(sea, qv, vmap)
            if (_c2 && _c2.size && _c2.size < vmap.size * 0.9) _vecCand = _c2
          }
        } catch {}
        try { mark('sem1') } catch {}
        const _qTok = (() => { const out = new Set(); const tt = String(query || ''); for (const seg of (tt.match(/[\u4e00-\u9fa5]+/g) || [])) { for (let i2 = 0; i2 + 2 <= seg.length; i2++) out.add(seg.slice(i2, i2 + 2)) } for (const w of (tt.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w); return out })()
  // 打分也认扩张词：光进候选不进分，等于白扩（2026-11-19）
  try { for (const _w of expandQuery(query)) for (const _g of gramsOf(_w, { single: true })) _qTok.add(_g) } catch {}
        let _intentOp = false
        try { _intentOp = (process.env.C2_INTENT2 === '0' ? classifyIntent(query || '') : classifyIntent2(query || '')) === 'op' } catch {}
        for (const [id, vec] of vmap) {
          if (_vecCand && !_vecCand.has(id)) continue
          if (_cand && !_cand.has(id)) { _annSkipped++; continue }
          const p = byId2.get(id)
          if (!p || p.dead || p.archived) continue
          const sim = cosine(qv, vec)
          // 倒排里一个字都没共用的，除非语义特别像，不然不必再算字组（2026-11-18 夜）
          if (_lexCand && !_lexCand.has(id) && sim < 0.62) continue
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
          // 稀有词把关（工具侧）：纯语义命中，得有一个"这件事独有"的词真出现过
          let _s2 = sim * 0.95
          try {
            const _tk = (s0) => {
              const out = new Set()
              const tt = String(s0 || '')
              for (const seg of (tt.match(/[\u4e00-\u9fa5]+/g) || [])) {
                for (let i2 = 0; i2 + 2 <= seg.length; i2++) out.add(seg.slice(i2, i2 + 2))
              }
              for (const w of (tt.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w)
              return out
            }
            const _ent = p.entities || p.entity
            const _txt = [p.title, p.text, p.alias, Array.isArray(_ent) ? _ent.join(' ') : _ent].filter(Boolean).join(' ')
            const _mt = _tk(_txt)
            const _q = _qTok
            const _df = _rareDf
            const _rareMax = _rareMaxG
            let hitRare = false
            for (const g of _q) if (_mt.has(g) && (_df.get(g) || 0) <= _rareMax) { hitRare = true; break }
            if (!hitRare && sim < 0.75) _s2 *= 0.55
            if (_intentOp && /成了|跑通|定了|记一|踩坑|实测|修好|搬上|接进|上线/.test(String(p.title || ''))) _s2 *= 0.5
          } catch {}
          scored.push({ p, hit: sim * 2, score: _s2, why: ['语义 ' + sim.toFixed(2)] })
          }
        }
        scored.sort((a, b) => b.score - a.score)
        try { mark('sem2') } catch {}
      }
    } catch {}

    // 语义层这会儿通不通，明说一句——默认开着它，挂了要有人知道
    let vectorNote = ''
    try {
      const eh = embedHealth()
      if (eh.down) vectorNote = '\n（近似检索这会儿没连上，只按字面找的。可能漏掉意思相近但用词不同的那些。）'
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
        return { ok: true, log: windowEmpty(tw.label) }
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

    // 字面兜底：全文索引命中了、但没向量所以在语义那步缺席的条目，
    // 只要标题里真有这串字，就给它一个保底分——别让"写了却搜不到"。
    // 2026-11-15 实测：#127 #129 #138 #143 #144 就是这么永远进不了结果的。
    {
      const _have = new Set(scored.map((x) => x.p.id))
      const _q = String(query || '').trim()
      if (_q.length >= 3) {
        for (const p of data.points || []) {
          if (p.dead || p.archived || _have.has(p.id)) continue
          if (String(p.title || '').includes(_q)) {
            scored.push({ p, rel: 1, score: 0.99, why: ['标题就是这句'] })
            _have.add(p.id)
          }
        }
      }
    }

    // 一条都没有时，先按同义词直扫全库，再决定是不是真的没有。
    // 2026-11-11：兜底原来放在空结果判断后面，永远没机会跑。
    if (!scored.length) {
      try {
        const _gU = new URL('./gate.js?v=' + Date.now(), import.meta.url).href
        const _g = await import(_gU)
        const _res = _g.rescueScan(data.points, query, Math.max(2, limit))
        // 直扫是补漏，不是推倒重来：已有的字面候选留着一起排（2026-11-18 夜）
        if (_res.length) { for (const _r of _res) { _r.why = ['直扫救回']; if (!scored.some((x) => x.p.id === _r.p.id)) scored.push(_r) } scored.sort((a, b) => b.score - a.score) }
      } catch {}
    }

    if (!scored.length) {
      // 空结果不是一种，是四种。措辞不同，模型就不会把「没检索到」讲成「我不记得了」
      // 风险文档：「空结果被讲成失忆」——她之前被骂过「昨晚的事全忘了」
      // 2026-11-21：原来只分「有活条目」和「空库」。库里全是沉底或删掉的条目时，
      // 它照样说「确实没写过」——写过，只是沉下去了。多一条实话。
      const hasAny = (data.points || []).some((p) => !p.dead)
      const onlyBuried = !(data.points || []).some((p) => p && !p.dead && !p.archived)
        && (data.points || []).some((p) => p && (p.dead || p.archived))
      const isTimeQ = /今天|昨天|前天|最近|上周|上个月|本周/.test(query)
      let why
      if (!hasAny) {
        why = '这个识海还是空的。\n（不是忘了，是还没开始记。）'
      } else if (onlyBuried) {
        why = '这条翻不上来——它沉底了或者被删了。\n（不是我忘了写过，是它已经不在明面上了。）'
      } else if (isTimeQ) {
        why = '那段时间我还没开始记东西。\n（不是忘了，是那会儿还没有识海。）'
      } else if (query.length <= 2) {
        why = '「' + query + '」这个线索太短，对不上。\n（给个更具体的说法，比如人名、地点、哪件事。）'
      } else {
        why = notRecorded(query)
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
    try { mark('graph') } catch {}
      const byId = new Map()
      for (const p of data.points) byId.set(p.id, p)
      for (const [id, w] of walk) {
        if (seeds.includes(id)) continue
        const p = byId.get(id)
        if (!p || p.dead || p.archived) continue
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
          if (!p || p.dead || p.archived) continue
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
    // 2026-11-14 审计：原来直接 scored[0].p，候选取空就抛 TypeError 被空 catch 吞掉，
    // 看起来"记账失败不影响搜索"，其实是这条记账从来没成功过一次空结果。
    try {
      if (!scored.length) throw new Error('no-hit')
      const top = scored[0].p
      const h = defaultMood(tickHeart(readHeart()))
      h.lastThought = { title: String(top.title || ''), at: Date.now() }
      applyMood(h, judgeEmotion(String(query || '')))
      writeHeart(h)
    } catch {
      /* 记账失败不影响搜索 */
    }

    let _touch = false
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
      if (changed || _touch) {
        backupSea(sea)
        writeChecked(sea, data, 'tool-main')
      // 写完立刻补向量：不补的话，这条对新查询是语义盲区
      // 补不上也要说一声——不许让「记忆写进去了、语义层看不见」变成静默缺陷
      // 2026-11-20：这里原来写进一个只在块里活着的变量，外头没人用——说好「补不上也要说一声」，
      // 其实一声都没出。改用外面那个提示变量（它本来就跟着结果一起回去）。
      try {
        const _d2 = readSea(sea)
        const _n = _d2 ? await syncVectors(sea, _d2, 8) : 0
        if (!_n) vectorNote += '\n（这回只能按原话找，换个意思相近的说法我可能接不上。等它缓过来就好。）'
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
    // 候选太少时，词门别把最后一条也删光：给一条并标注不确定，好过空手（2026-11-19）
    try { if ((!_kept || !_kept.length) && scored.length && scored.length <= 3) _kept = [scored[0]] } catch {}
    try { if (process.env.C2_TRACE === '1') console.error('[trace] gate has54=' + scored.some((x) => x.p.id === 54) + ' n=' + scored.length) } catch {}
    try { mark('gate') } catch {}
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
    try { mark('rescue') } catch {}
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
      if (args.review === false) throw new Error('skip');
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
        _touch = true
        try { audit('mark-closed', { n: _closed, q: String(query || '').slice(0, 24) }) } catch {}
      }
    } catch {}

    // 问了却没真答上：只剩"语义保底 / 直扫救回"捞回来的，说明库里没这件事。
    // 把最像的那条标成"还开着"，以后它就会被当成悬着的事反复回到。自动的，不用手标。
    // 2026-11-11 晚。原来写在"空结果"分支里，结果被保底挡住，永远跑不到。
    try {
      if (args.review === false) throw new Error('skip');
      const _ok = scored.slice(0, limit)
      const _why0 = _ok[0] && Array.isArray(_ok[0].why) ? _ok[0].why.join(' ') : ''
      const _weak = _ok.length > 0 && (_why0.includes('没这个值') || _ok.every((x) => {
        const w = Array.isArray(x.why) ? x.why.join(' ') : ''
        return (w.includes('语义保底') || w.includes('直扫救回') || w.includes('没这个值'))
      }))
      if (_weak && _ok[0] && _ok[0].p) {
        const target = _ok[0].p
        if (target.open !== true) {
          target.open = true
          _touch = true
          try { audit('mark-open', { id: target.id, q: String(query || '').slice(0, 24), why: 'only-weak' }) } catch {}
        }
      }
    } catch {}

    // 「关掉」和「标成还开着」只改内存，到这儿合并着写一次（2026-11-19）。
    // 原来这两处各写一遍整库：一次搜索 = 三次备份 + 三次全量落盘，并发下互相盖。
    if (_touch) {
      try { backupSea(sea) } catch {}
      try { writeChecked(sea, data, 'tool-main') } catch {}
    }

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
    // 2026-11-19 修：原来这里只按片段命中数重排，把前面算好的分数整个盖掉了（清单 P30）。
    // 改成"片段命中当加分项"：最多加 0.10，分数本身仍然是主，不会一句话把排序翻过来。
    try {
      const _q = String(query || '').replace(/[\s\u3000，。、！？；：""''（）()《》·…—\-.,!?;:'"()]/g, '')
      if ([..._q].length >= 8) {
        const grams = []
        for (let i = 0; i + 2 <= _q.length; i++) grams.push(_q.slice(i, i + 2))
        const maxGram = Math.max(1, grams.length)
        const bonus = new Map()
        for (const x of scored) {
          const hay = String((x.p && x.p.title) || '') + String((x.p && x.p.text) || '').slice(0, 300)
          let n = 0
          for (const g of grams) if (hay.includes(g)) n++
          bonus.set(x, 0.10 * (n / maxGram))
        }
        scored.sort((a, b) => ((Number(b.score) || 0) + (bonus.get(b) || 0)) - ((Number(a.score) || 0) + (bonus.get(a) || 0)))
      }
    } catch {}

    // 拼音双通道（2026-11-16 清单第 17 件）：字面头名不够硬才走这条道。
    // 问「酥酥侠」「ssx」时字面全空、向量也不认同音——拼音能把同音的捞回来。
    // 别先纠错再检索：模型纠错精度只有 26%，直接拼音撞更稳（清单写死）。
    try {
      const _bestRel = scored.length ? scored.reduce((m, x) => Math.max(m, Number(x.rel) || 0), 0) : 0
      if (_bestRel < 0.8) {
        const py = await import('./pinyin.js')
        const qSide = py.pinyinQuery(query)
        const qGood = qSide.full.length >= 2 || qSide.initials.length >= 2
        if (qGood) {
          const _seen = new Set(scored.map((x) => String(x.p && x.p.id)))
          const _hits = []
          for (const _pp of data.points) {
            if (_pp.dead || _pp.archived) continue
            if (_seen.has(String(_pp.id))) continue
            const _r = py.pinyinRel(qSide, _pp)
            if (_r > 0) _hits.push({ p: _pp, r: _r })
          }
          if (_hits.length) {
            _hits.sort((a, b) => b.r - a.r)
            for (const _h of _hits.slice(0, 6)) {
              scored.push({ p: _h.p, hit: 1, rel: _h.r, score: 0.5 + _h.r, why: ['拼音 ' + _h.r.toFixed(2)] })
            }
            scored.sort((a, b) => {
              const wa = (Array.isArray(a.why) ? a.why : []).join(' ')
              const wb = (Array.isArray(b.why) ? b.why : []).join(' ')
              const pa = wa.includes('拼音') ? 1 : 0
              const pb = wb.includes('拼音') ? 1 : 0
              if (pa !== pb) return pb - pa
              return (Number(b.score) || 0) - (Number(a.score) || 0)
            })
            try { audit('search-pinyin', { sea, q: String(query || '').slice(0, 24), n: _hits.length }) } catch {}
          }
        }
      }
    } catch (e) {
      try { audit('search-pinyin-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    }

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
            scored.unshift({ p: _p2, hit: 1, rel: 1, score: 0.88, why: ['整句兜底'] })
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
    try { mark('vector') } catch {}
    try { mark('rerank') } catch {}
    // 重排护栏：字面命中明显赢的时候，别让重排一票压掉（2026-11-19）
    let _preTop = null
    try {
      const f = scored[0]
      if (f && f.p) _preTop = { id: Number(f.p.id), hit: Number(f.hit) || 0, ref: f }
    } catch {}
    try { scored = rerank(scored, query) } catch {}
    try { const RG = await import('./rerankguard.js'); scored = RG.applyRerankGuard(_preTop, scored) } catch {}
    // 问「当时」就往老的那条挪，问「现在」就往新的挪（2026-11-19）
    try { const TN = await import('./tense.js'); scored = TN.applyTenseRank(query, scored) } catch {}
    // 先看你问的是哪一样，再决定把什么往前挪：问时间的，带日子的先上；问后来的，说清结果的先上。
    // 只动顺序，不动有没有；判不准就当普通。2026-11-17 晚。
    try {
      const _at = await import(new URL('./asktype.js?v=' + Date.now(), import.meta.url).href)
      const _ask = _at.classifyAsk(query)
      if (_ask && _ask !== 'exist') {
        _at.rerankByAsk(scored, _ask, (x) => String((x.p && x.p.title) || '') + '。' + String((x.p && x.p.text) || ''))
        scored.sort((a, b) => b.score - a.score)
      }
    } catch {}

    // 关系网扩一层（默认关）：前 3 条命中各带最多 2 个邻居进来，分数打 0.45 折。
    // 开关用环境变量，先在沙箱里量，不急着做成配置项。2026-11-15 凌晨。
    // 默认开；要退回旧行为：环境变量 C2_REL_NEIGHBOR=0。
    let _rels = (Array.isArray(data.relations) && data.relations.length) ? data.relations : (Array.isArray(data.edges) ? data.edges : [])
    if (!_rels.length) {
      // 传进来的 data 可能已经被瘦身（只剩 points），边得回库里去拿（2026-11-19 凌晨）
      try { const _st = await import('./store.js'); const _full = _st.readSea(sea); if (_full && Array.isArray(_full.edges)) _rels = _full.edges } catch {}
    }
    if (process.env.C2_REL_NEIGHBOR !== '0' && _rels.length) {
      try { if (process.env.C2_TRACE === '1') console.error('[trace] rel in, rels=' + _rels.length + ' scored=' + scored.length + ' limit=' + limit) } catch {}
      try {
        const byId = new Map((data.points || []).map((p) => [p.id, p]))
        const nb = new Map()
        for (const r of _rels) {
          // 2026-11-20：库里的边字段是 from/to，这儿却按 a/b 取——取出来全是 undefined，
          // 邻居表只在 undefined 这个键上转，一条邻居也加不进去。两种写法都认。
          const _a = r.a !== undefined ? Number(r.a) : Number(r.from)
          const _b = r.b !== undefined ? Number(r.b) : Number(r.to)
          if (!Number.isFinite(_a) || !Number.isFinite(_b)) continue
          if (!nb.has(_a)) nb.set(_a, [])
          if (!nb.has(_b)) nb.set(_b, [])
          nb.get(_a).push(_b)
          nb.get(_b).push(_a)
        }
        const have = new Set(scored.map((x) => x.p.id))
        try { if (process.env.C2_TRACE === '1') console.error('[trace] rel nb=' + nb.size + ' have=' + have.size) } catch {}
        const seeds = scored.slice(0, 3)
        let added = 0
        for (const seed of seeds) {
          for (const nid of (nb.get(seed.p.id) || []).slice(0, 2)) {
            if (have.has(nid) || added >= 4) continue
            const np = byId.get(nid)
            if (!np || np.dead || np.archived) continue
            have.add(nid)
            scored.push({ p: np, score: seed.score * Number(process.env.C2_REL_W || 0.45), why: ['顺着关系找来的'] })
            added++
          }
        }
        if (added) scored.sort((a, b) => b.score - a.score)
      } catch {}
    }

    // 幽灵拒答（默认关，C2_GHOST_REFUSE=1 才开）：
    // 问句里没有一个两字词出现在任何标题/别名里，且稀有词命中<=1 —— 判"没写过"。
    // 2026-11-15 凌晨量过：六件假事拒 4、留出集 0/20 误伤、九十条真问题误伤 3。
    // 默认开（苏苏侠定的：不要人工开关）。要退回旧行为就设 C2_GHOST_REFUSE=0。
    if (process.env.C2_GHOST_REFUSE !== '0' && scored.length) {
      try {
        const _p2 = (data.points || []).filter((p) => !p.dead && !p.archived)
        const _all = (p) => String(p.title || '') + String(p.text || '') + String(p.alias || '')
        const _dfc = new Map()
        const _df = (g) => {
          if (_dfc.has(g)) return _dfc.get(g)
          let n = 0
          for (const p of _p2) if (_all(p).includes(g)) n++
          _dfc.set(g, n)
          return n
        }
        const _q3 = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
        const _gs = []
        for (let i = 0; i + 1 < _q3.length; i++) _gs.push(_q3.slice(i, i + 2))
        const _rare = _gs.filter((g) => { const d = _df(g); return d > 0 && d <= _p2.length * 0.1 }).length
        const _titleHit = _gs.some((g) => _p2.some((p) => (String(p.title || '') + String(p.alias || '')).includes(g)))
        const _w0 = Array.isArray(scored[0].why) ? scored[0].why.join(' ') : ''
        const _sem0 = Number((_w0.match(/语义\s*([0-9.]+)/) || [])[1] || 0)
        // 头一条本身就挺像（语义 >=0.5）就别拒——实测「你会害怕吗」能答到 #17，别误杀
        // 字面已经对上了（哪怕标题没对上），就不是「没写过」——2026-11-18 夜
        const _lit0 = Number((_w0.match(/字面\s*([0-9.]+)/) || [])[1] || 0)
        // dbg
        // 候选就没得选的时候别硬拒：库里只两三条、头一条还有字面对上，说明不是「没写过」（2026-11-19）
    if (!_titleHit && _rare <= 1 && _sem0 < 0.50 && _lit0 < 0.15 && !(_lit0 > 0 && scored.length <= 3)) {
          // 2026-11-21：同一个判据——问句里有三个两字词撞上同一条，就是「这事记着」，
          // 只该说「没这细节」，不许说「没记过」。
          const _sub = (await import('./subject.js')).subjectHit(query, (data.points || []))
          if (_sub) {
            try {
              const R3 = await import('./refusal.js')
              return { ok: true, log: R3.knownNoDetail(query, _sub), conf: 'none' }
            } catch {}
          }
          return { ok: true, log: notRecorded(query), conf: 'none' }
        }
      } catch {}
    }

    // 幽灵拒答二档（2026-11-16 夜试过一版，**默认关**，C2_GHOST2=1 才开）：
    // 三百七十道题上量过：反例有回话 30/41 → 16/41，盲测头名 94.3 → 93.4（掉一条），
    // 看着不错；但它把「没模型包也能搜」「没记过就说没有」「陌生海端到端」三条既有保证弄红了
    // （小海、无向量、只靠关系命中的场合被误拒）。先退回默认关，等把这三处判据重做再开。
    if (process.env.C2_GHOST2 === '1' && process.env.C2_GHOST_REFUSE !== '0' && scored.length) {
      try {
        const _p3 = (data.points || []).filter((p) => !p.dead && !p.archived)
        const _q4 = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
        const _g4 = []
        for (let i = 0; i + 1 < _q4.length; i++) _g4.push(_q4.slice(i, i + 2))
        const _dfc4 = new Map()
        const _df4 = (g) => {
          if (_dfc4.has(g)) return _dfc4.get(g)
          let n = 0
          for (const p of _p3) {
            if ((String(p.title || '') + String(p.text || '') + String(p.alias || '')).includes(g)) n++
          }
          _dfc4.set(g, n)
          return n
        }
        const _rareCount = _g4.filter((g) => { const d = _df4(g); return d > 0 && d <= _p3.length * 0.1 }).length
        const _w1 = Array.isArray(scored[0].why) ? scored[0].why.join(' ') : ''
        const _sem1 = Number((_w1.match(/语义\s*([0-9.]+)/) || [])[1] || 0)
        const _lit = /字面|实体|别名/.test(_w1)
        if (_sem1 > 0 && _rareCount === 0 && !_lit && _sem1 < 0.62) {
          return { ok: true, log: notRecorded(query), conf: 'none' }
        }
      } catch {}
    }


    if (_referent) {
      try {
        const _low = _referent.replace(/那个东西|那件事|它|这个/g, '')
        for (const x of scored) {
          const t = String((x.p && x.p.title) || '') + String((x.p && x.p.text) || '')
          if (_low && t.includes(_low.slice(0, 8))) x.score += 0.2
        }
        scored.sort((a, b) => b.score - a.score)
      } catch {}
    }
    // 你说的是哪一件——必须在拼卡片之前定：一件明显更新就先答那件，两件一样新才停下问。
    let _ambNote = ''
    try {
      const _am0 = await import(new URL('./ambiguity.js?v=' + Date.now(), import.meta.url).href)
      const _amr0 = _am0.ambiguityAsk(query, ((data && data.points) || []).map((p) => ({ p })))
      // 2026-11-20：这里的 logId 在函数后面才声明（第 2479 行附近）。同一个函数作用域里，
      // 声明之前引用就是「时序死区」，一引用就抛，外面那层空 catch 吞掉——
      // 也就是说「两件都像，问一问是哪件」这条路一次都没走成过。这会儿还没记日志，回空就好。
      if (_amr0 && _amr0.kind === 'ask') return { ok: true, logId: null, log: _amr0.text }
      if (_amr0 && _amr0.kind === 'guess') {
        _ambNote = _amr0.text
        const _want = Number((_amr0.pick && _amr0.pick.id) || 0)
        const _at = scored.findIndex((x) => Number(x.p && x.p.id) === _want)
        if (_at > 0) scored.unshift(scored.splice(_at, 1)[0])
      }
    } catch {}

    // 学出来的重排：放在最终定序前，只动前十二名，错了也只错一小段。
    // 关掉：C2_RERANK_MODEL=0；回滚：换 assets/rerank/model.json
    let _gateBlocked = false
    try {
      const RM = await import('./rerank-learned.js')
      const _m = RM.loadModel()
      // 2026-11-19：向量修对之后，这套学出来的权重反而更差（329 题 95.1% → 94.2%）。
      // 改成默认停用、要试才开：C2_RERANK_MODEL=1。
      if (_m && scored.length > 1 && String(process.env.C2_RERANK_MODEL || '') === '1') {
        const _top = scored.slice(0, 12)
        const _rest = scored.slice(12)
        let _qv = null
        try { _qv = await embedQuery(query) } catch {}
        const _vm = _qv ? loadVectors(sea) : null
        const _rows = _top.map((x) => {
          const v = _vm ? _vm.get(x.p.id) : null
          const cs = (_qv && v) ? cosine(_qv, v) : 0
          return { x, p: RM.probOf(RM.featuresOf(query, x.p, cs), _m) ?? 0 }
        })
        const _gate = Number(process.env.C2_RERANK_GATE || 0.10)
        if (Math.max(..._rows.map((r) => r.p)) < _gate && (Number(_top[0] && _top[0].score) || 0) < 0.5) _gateBlocked = true
        const _ps = _rows.map((r) => r.p)
        const _mx = Math.max(..._ps)
        const _mn = Math.min(..._ps)
        // 差距太小就别动——没把握的重排只是换一种错法
        if (_mx - _mn > 0.12) {
          _rows.sort((a, b2) => b2.p - a.p)
          scored = _rows.map((r) => r.x).concat(_rest)
        }
      }
    } catch {}

    // 第二道闸拦下：不硬答，明说没记住（2026-11-18 夜）
    if (_gateBlocked) {
      try { recordMiss(sea, query, 'rerank-gate') } catch {}
      return { ok: true, log: weakScore(query) }
    }

    // 改口裁决：问「现在」还是问「当时」，旧版该往后还是往前
    let _verdictNote = ''
    try {
      const VM = await import('./verdict.js')
      const _vr = VM.applyVerdict(scored, query)
      _verdictNote = VM.verdictNote(_vr.intent)
    } catch {}

    try { finish() } catch {}
    try {
      const _ms = Date.now() - _slowT0
      const _segs = profRecent.length ? profRecent[profRecent.length - 1] : null
      noteSlow({ ms: _ms, sea, q: query, seg: _segs })
    } catch {}
    // 同主题最多三条：八条里有六条在说一件事，不是记得多，是没得选（2026-11-19 凌晨）
    // 一个字都对不上，就是没记过：编的问题别硬答（2026-11-19 凌晨）
    try {
      if (String(process.env.C2_ZERO_GATE || '0') === '1' && scored.length) {
        const _qg = gramsOf(query, { single: false })
        if (_qg && _qg.size) {
          let _any = false
          for (const x of scored.slice(0, 3)) {
            const _tg = gramsOf(String(x.p.title || '') + String(x.p.text || ''), { single: false })
            for (const g of _qg) if (_tg.has(g)) { _any = true; break }
            if (_any) break
          }
          if (!_any) { try { noteSlow({ ms: Date.now() - _slowT0, sea, q: query, seg: { zero: 1 } }) } catch {} ; return { ok: true, log: notRecorded(query), conf: 'none' } }
        }
      }
    } catch {}
    // 两条都低：默认只轻声说一句「对得不准」，不拒答；显式开 C2_FAKE_GATE=1 才拒
    let _weakNote = ''
    let _timeNote = ''
    try {
      if (scored.length) {
        const _qg2 = gramsOf(query, { single: false })
        let _cov = 0
        if (_qg2 && _qg2.size) {
          const _tg2 = gramsOf(String(scored[0].p.title || '') + String(scored[0].p.text || ''), { single: false })
          let _h = 0
          for (const g of _qg2) if (_tg2.has(g)) _h++
          _cov = _h / _qg2.size
        }
        const _hit0 = Number(scored[0].hit) || 0
        if (_cov < Number(tuning().weakCov ?? 0.2) || _hit0 < Number(tuning().weakHit ?? 60)) _weakNote = '\n（这条我对得不准，你自己再核一眼。）'
        if (tw && tw.fuzzy) _timeNote = '\n（你给的是大跨度时间，我只按内容找，没按时间卡。）'
        if (String(process.env.C2_FAKE_GATE || '') === '1' && _cov < Number(tuning().weakCov ?? 0.2) && _hit0 < Number(tuning().weakHit ?? 60)) return { ok: true, log: notRecorded(query), conf: 'none' }
      }
    } catch {}
    const _dmax = String(process.env.C2_DIVERSITY || '') === '0' ? limit : Number(tuning().divMax ?? 3)
    const _dth = Math.max(0.3, Math.min(0.95, Number(process.env.C2_DIV_TH) || Number(tuning().divTh ?? 0.6)))
    try { if (process.env.C2_TRACE === '1') console.error('[trace] out has54=' + scored.some((x) => x.p.id === 54) + ' top=' + scored.slice(0, 4).map((x) => x.p.id + ':' + Number(x.score).toFixed(2)).join(' ')) } catch {}
    // 2026-11-21：问「多久／哪一年」的时候，正文里真带时长、真带年份的那条该往前站；
    // 只顾字面像的条目会把时间问题顶到不相干的地方。通用规则，不认具体题面。
    try {
      const _q = String(query || '')
      const _isTimeQ = /多久|多长时间|几年|几个月|几天|哪一年|什么时候|几月|哪个月/.test(_q)
      if (_isTimeQ && scored.length) {
        const _wantDur = /多久|多长时间|几个月|几天|几年/.test(_q)
        const _re = _wantDur
          ? /([0-9一二三四五六七八九十百]+)\s*(年|个月|月|天|周|礼拜|小时)/
          : /((19|20)[0-9]{2})|([0-9]{4})\s*年|[一二三四五六七八九十]{1,4}月/
        // 2026-11-21 二十点二五：只靠时间字眼就把一条顶上去，会答偏——「他第一次坐飞机是哪一年」被顶到
        // 一条也带年份、可跟坐飞机无关的记忆上。加一道主体重叠：问句拆二字组（去掉时间词），
        // 条目正文或标题至少撞上两组，才给它时间加权。
        const _qcore = _q.replace(/多久|多长时间|几年|几个月|几天|哪一年|什么时候|几月|哪个月|哪个|多少|什么|那|这/g, '')
        const _grams = new Set()
        for (let _i = 0; _i < _qcore.length - 1; _i++) {
          const g = _qcore.slice(_i, _i + 2)
          if (/^[\u4e00-\u9fa5]{2}$/.test(g)) _grams.add(g)
        }
        for (const x of scored) {
          const txt = String((x.p && x.p.title) || '') + String((x.p && x.p.text) || '')
          let ov = 0
          for (const g of _grams) if (txt.includes(g)) { ov++; if (ov >= 2) break }
          if (ov < 2) continue
          if (_re.test(String((x.p && x.p.text) || ''))) x.score = (Number(x.score) || 0) + 0.12
        }
        scored.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      }
    } catch {}
    const _picked = pickDiverse(scored, limit, _dmax, _dth)
    // 2026-11-20 夜（第一条路）：问「最高/最多」时，别让排序替我算数。
    // 候选里扫一遍带数量级的说法，取最大的那个，先摆出来，标明哪条、哪天。
    // 2026-11-20：问「现在/今天/最近」时，抬头把此刻的时间写出来，让人一眼知道我按哪天答。
    let _nowNote = ''
    try {
      if (/现在|今天|最近|当前/.test(String(query || ''))) {
        const d = new Date()
        const z = (n) => String(n).padStart(2, '0')
        _nowNote = '（此刻 ' + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + '）\n'
      }
    } catch {}
    let _supNote = ''
    try {
      if (/最高|最多|最大/.test(String(query || ''))) {
        const _numOf = (t) => {
          const m = String(t).match(/([0-9]+(?:\.[0-9]+)?|[一二三四五六七八九十百千]+)\s*([万亿])/)
          if (!m) return 0
          // 「千千万万个窗口」也会被当成数字——必须紧挨着播放/视频/跑/涨/粉 才算数
          const _at = m.index || 0
          const _win = String(t).slice(Math.max(0, _at - 24), _at + m[0].length + 24)
          if (!/播放|视频|跑了|跑出|涨|粉|观看|阅读/.test(_win)) return 0
          const cn = { 一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,百:100,千:1000 }
          let v = 0
          if (/^[0-9]/.test(m[1])) v = Number(m[1])
          else {
            let cur = 0
            for (const ch of m[1]) {
              if (cn[ch] === undefined) continue
              if (cn[ch] >= 10) { cur = (cur || 1) * cn[ch] } else { cur += cn[ch] }
            }
            v = cur || 0
          }
          return v * (m[2] === '万' ? 10000 : 100000000)
        }
        let best = 0
        let bestP = null
        // 扫整片海，不是只扫前二十：十七万那条压根不在候选里，只看候选永远找不到它。
        for (const p0 of ((data && data.points) || [])) {
          if (!p0 || p0.dead || p0.archived) continue
          const t = String(p0.title || '') + ' ' + String(p0.text || '')
          const v = _numOf(t)
          if (v > best) { best = v; bestP = p0 }
        }
        // 顺便把「更早的几条」也摆出来：同一个数变过好几次，只报一个会误导。
        const _vals = []
        for (const p0 of ((data && data.points) || [])) {
          if (!p0 || p0.dead || p0.archived) continue
          const t = String(p0.title || '') + ' ' + String(p0.text || '')
          const v = _numOf(t)
          if (v > 0) _vals.push({ v, id: p0.id, born: Number(p0.born) || 0 })
        }
        _vals.sort((a, b) => b.v - a.v || b.born - a.born)
        const _top = []
        for (const x of _vals) { if (!_top.some((y) => y.v === x.v)) _top.push(x); if (_top.length >= 3) break }
        if (bestP && best > 0) {
          const d = Number(bestP.born) ? localMmDd(Number(bestP.born)) : '时间未知'
          const _disp = best >= 100000000 ? (best / 100000000) + ' 亿' : best >= 10000 ? (best / 10000) + ' 万' : String(best)
          _supNote = '（按记载最大是 ' + _disp + '：#' + bestP.id + '，' + d + '）\n'
          const _rest = _top.slice(1).map((x) => {
            const dd = x.born ? localMmDd(x.born) : '时间未知'
            return (x.v >= 100000000 ? (x.v / 100000000) + ' 亿' : x.v >= 10000 ? (x.v / 10000) + ' 万' : String(x.v)) + '（#' + x.id + '，' + dd + '）'
          })
          if (_rest.length) _supNote += '（更早的：' + _rest.join('、') + '，别拿旧的当现状）\n'
          // 会变的数会过期：超过三十天就明说，别让人以为是今天的数。
          try {
            const _age = bestP && Number(bestP.born) ? Math.floor((Date.now() - Number(bestP.born)) / 86400000) : null
            if (_age !== null && _age > 30) _supNote += '（这条是 ' + _age + ' 天前的数，可能已经变了）\n'
          } catch {}
        }
      }
    } catch {}
    const lines = _picked.map((x) => {
      const p = x.p
      const _d = detailFor(p)
      const _tt = String(p.text || '').replace(/\s+/g, ' ')
      const body = _tt.slice(0, _d.len) + (_tt.length > _d.len ? '…' : '') + _d.note
      const from = p._from ? '〈来自 ' + p._from + '〉' : ''
      const hitTxt = Number(x.hit) >= 1 ? Math.round(Number(x.hit)) : Number(x.hit).toFixed(2)
      // 为什么想起它——给模型一句理由，它才会真的用；给人一句理由，才看得出准不准
      let whyTxt = ''
      try {
        const ws = Array.isArray(x.why) && x.why.length ? x.why.slice(0, 3) : []
        // 2026-11-21：本机这层的「向量」是字典哈希，不是真语义模型——给人看的字不许再叫「语义」。
        // 只改显示，不动内部计分（动了会让一堆阈值失效）。
        if (ws.length) whyTxt = ' 〔' + ws.join(' · ').replace(/语义\s/g, '形近 ') + '〕'
      } catch {}
      let markTxt = ''
      try { markTxt = markText(p) } catch {}
      // 2026-11-21：问的是数/是哪句，而这条正文里连个数字都没有——那它只是挨着，
      // 不是答案。标出来，别让人把邻条当成你要的那条。
      let nearTxt = ''
      try {
        // 问句里「哪/多少」后面那个名词，就是他要的东西；这条正文里压根没这个词，
        // 那它只是挨着——别让人把邻条当成答案。
        const _m = String(query || '').match(/(?:哪|多少)([一-龥]{2,3})/)
        const _noun = _m ? _m[1].replace(/(的|是|在|有|了|吗|呢)$/g, '') : ''
        if (_noun && _noun.length >= 2 && !String(p.text || '').includes(_noun) && !String(p.title || '').includes(_noun)) {
          nearTxt = ' 〔这条只是挨着，不是你要的那个「' + _noun + '」〕'
        }
        // 问时间（哪一年／多久）而这条正文里没有时间点：也得说清，别让人以为这就是答案。
        // 问「哪句话」而这条里没有一句引语：同样是挨着，不是答案。
        if (!nearTxt && /哪一句|哪句话|哪句/.test(String(query || '')) && !/[\u300c\u201c"]/.test(String(p.text || ''))) {
          nearTxt = ' 〔这条只是挨着：你要的那句原话，它里面没有〕'
        }
        if (!nearTxt && /多久|多长时间|几年|几个月|几天|哪一年|什么时候|几月|哪个月/.test(String(query || ''))) {
          const _hasTime = /([0-9一二三四五六七八九十百]+)\s*(年|个月|月|天|周|礼拜|小时)/.test(String(p.text || ''))
          if (!_hasTime) nearTxt = ' 〔这条只是挨着：你要的时间点，它没写〕'
        }
      } catch {}
      // 写的时候就泛：露出来，别让"记得"和"写得实"混成一回事
      try { if (p.flat) markTxt += '〔这条当时写得泛〕' } catch {}
      // 后来补的批注：搜到这条时也得看见，不然批注只活在注入那一层。
      let noteTxt = ''
      try {
        const ns = Array.isArray(p.notes) ? p.notes.filter((q) => q && String(q.text || '').trim()) : []
        if (ns.length) {
          const last = ns[ns.length - 1]
          const dd = new Date(Number(last.t) || 0)
          const day = Number.isFinite(dd.getTime()) ? (dd.getMonth() + 1) + '月' + dd.getDate() + '日' : ''
          noteTxt = '\n  后来补一句' + (day ? '（' + day + '）' : '') + '：' + [...String(last.text)].slice(0, 60).join('')
        }
      } catch {}
      return '· #' + p.id + ' ' + p.title + from + '（' + bornLabel(p) + '，对上 ' + hitTxt + '）' + markTxt + nearTxt + whyTxt + '\n  ' + vagueFor(p).prefix + body + noteTxt + vagueFor(p).suffix + conflictNote(p) + supersededNote(p)
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
// 2026-11-20：这个「上次接话时间」原来是个局部变量，每次检索都从零开始——
// 注释写着「十分钟最多一次」，其实一次也管不住：每回都被当成头一回。
// 改成从一个小文件读、接完话写回去（放在已有的 .dsh 下，不另建目录）。
let _lastContactAt = 0
const _contactFile = join(HOME, '.dsh', 'last-contact.json')
try {
  if (existsSync(_contactFile)) _lastContactAt = Number(JSON.parse(readFileSync(_contactFile, 'utf8')).at) || 0
} catch {}
    try {
      logId = logSearch({
        sea,
        query,
        tier: ['low', 'high', 'max'][qualityRank() - 1] || '',
        limit,
        // 2026-11-19：日志带上"为什么是这条"——命中路径、相对分、命中词。
        // 以前只存 id/标题/分数，事后想知道它凭什么排第一，只能重跑一遍。
        results: scored.slice(0, 8).map((x) => ({
          id: x.p.id,
          title: x.p.title,
          score: x.score,
          rel: x.rel,
          hit: x.hit,
          why: Array.isArray(x.why) ? x.why.slice(0, 3) : [],
        })),
        src: String((args && args.src) || 'tool'),
      })
    } catch (e) {
      // 记不下来别影响检索，但得留痕，不然永远不知道为什么 logId 是 null
      try { audit('searchlog-fail', { err: String((e && e.message) || e) }) } catch {}
    }

    // 问的是"有没有那个值"：候选里连那个形状都没有，多半不是答上了，是凑的。
    // 2026-11-19：以前逐条打标签（筛候选会把该答的一起筛掉），也试过硬拦（判据太粗）。
    // 现在只判一件事：前几条都没有这个形状的值，而且语义也不高——才算"没记过"。
    // 2026-11-20 夜（时间轴第二条）：问「最新/现在/当前/最高」时，近期条目加权。
    // 为什么要有：同一条事新旧两条并排躺着，排序不看时间，就会拿旧数当现状。
    try {
      if (process.env.C2_TRACE === '1') console.error('[trace] fresh-block entered, q=' + String(query || '').slice(0, 20) + ' scored=' + scored.length)
      if (/最新|现在|当前|最近|如今|这几天|最高|最新一次/.test(String(query || ''))) {
        // 先把最近的一批拉进候选：词闸只按字面筛，旧高峰往往把新的挤没。
        // 只拉「问句里至少有个二字组撞上」的，别为了新鲜乱塞。
        try {
          const _q = String(query || '').replace(/[\s，。？！、；：""''（）()]/g, '')
          const _qg = new Set()
          for (let i = 0; i + 1 < _q.length; i++) _qg.add(_q.slice(i, i + 2))
          const _have = new Set(scored.map((x) => x.p && x.p.id))
          const _recent = ((data && data.points) || [])
            .filter((p) => p && !p.dead && !p.archived && Number(p.born) > 0 && !_have.has(p.id))
            .sort((a, b) => Number(b.born) - Number(a.born))
            .slice(0, 40)
          for (const p of _recent) {
            const hay = String(p.title || '') + ' ' + String(p.text || '')
            let ok = false
            for (const g of _qg) { if (hay.includes(g)) { ok = true; break } }
            if (!ok && /最高|最新|最多|最大/.test(String(query || ''))) {
              // 问「最高/最新」但新记录换了说法（比如「跑了十七万」没有「播放量」这个词），
              // 只靠字面撞不上。补一条：近期 + 正文里有数量词，给个中等分让它进前三。
              if (/[0-9０-９一二三四五六七八九十百千]+\s*[万亿]|[0-9]{2,}/.test(hay)) ok = true
            }
            if (ok) scored.push({ p, hit: 1, score: /最高|最新|最多|最大/.test(String(query || '')) ? 0.30 : 0.22, why: ['近期'] })
          }
          if (process.env.C2_TRACE === '1') console.error('[trace] fresh added, scored=' + scored.length)
        } catch (e) { if (process.env.C2_TRACE === '1') console.error('[trace] fresh err ' + String((e && e.message) || e)) }
        const _T2 = tuning()
        const _boost = Number(_T2.freshBoost ?? 0.25)
        const _days = Number(_T2.freshDays ?? 7)
        const _now = Date.now()
        for (const x of scored) {
          const b = Number(x.p && x.p.born) || 0
          if (!b) continue
          const age = Math.max(0, (_now - b) / 86400000)
          const w = Math.max(0, 1 - age / (_days * 4))
          if (w > 0) {
            x.score = Number((Number(x.score) + _boost * w).toFixed(4))
            if (Array.isArray(x.why)) x.why.push('新')
          }
        }
        scored.sort((a, b) => b.score - a.score)
      }
    } catch {}
    let _shapeRefuse = false
    let _shapeKind = ''
    try {
      const _gs = await import(new URL('./gate.js?v=' + Date.now(), import.meta.url).href)
      const _intent = _gs.shapeIntent ? _gs.shapeIntent(query) : null
      if (_intent && _gs.shapeMissing) {
        const _txOf = (p) => String((p && p.title) || '') + '。' + String((p && p.text) || '') + '。' + String((p && p.alias) || '')
        // 问号码/密码：整片海都没有那个形状，才是没记过。
        // 问数量/日期：整片海都没有一句沾上问句的实词，才是没记过。
        // 判在整片海上，不判前三条——重排会换头名，判前三条会误伤（2026-11-19）。
        const _q2 = String(query || '').replace(/多少|几个|几号|哪天|什么时候|一共|到底|呢|吗|？|\?/g, '')
        const _grams = new Set()
        for (let i = 0; i + 1 < _q2.length; i++) _grams.add(_q2.slice(i, i + 2))
        let _anyShape = false
        let _anyTopical = false
        for (const x of scored.slice(0, Number(tuning().gatePool ?? 40))) {
          const p = x.p || {}
          if (!p.id) continue
          const t = _txOf(p)
          if (!_anyShape && !_gs.shapeMissing(query, t)) _anyShape = true
          if (!_anyTopical) {
            for (const g of _grams) if (t.includes(g)) { _anyTopical = true; break }
          }
          if (_anyShape && _anyTopical) break
        }
        if (_intent === 'code' ? !_anyShape : !_anyTopical) { _shapeRefuse = true; _shapeKind = _intent }
      }
      // 2026-11-19：问"那东西叫什么/什么牌子/第几组"这类具体专名。
      // 库里连那个主体词都没出现过（蜥蜴、跑鞋、单词书、私教），就不是答不上，是没记过。
      // 只在 entity 类上判，且必须整片海都没有这个词——宁可漏拒，不许误伤。
      // 跟幽灵拒答共用一个开关：C2_GHOST_REFUSE=0 时这条也不许动。
      if (!_shapeRefuse && _intent === 'entity' && _gs.subjectTerms && String(process.env.C2_GHOST_REFUSE || '1') !== '0') {
        const _subs = _gs.subjectTerms(query)
        if (_subs.length) {
          const _txOf2 = (p) => String((p && p.title) || '') + '。' + String((p && p.text) || '') + '。' + String((p && p.alias) || '')
          let _anySub = false
          for (const x of scored.slice(0, Number(tuning().gatePool ?? 40))) {
            const t = _txOf2(x.p || {})
            for (const s of _subs) if (t.includes(s)) { _anySub = true; break }
            if (_anySub) break
          }
          if (!_anySub) { _shapeRefuse = true; _shapeKind = 'entity' }
        }
      }
      // 2026-11-19 夜：要一个值，正文里却没有那个值——直说没记过。
      // 判据：问句在要数字或专名，而前五条候选的标题加正文里既没有数字、也没有英文名或引号里的专名。
      if (!_shapeRefuse && String(process.env.C2_GHOST_REFUSE || '1') !== '0') {
        const _ask = _gs.asksValue ? _gs.asksValue(query) : null
        if (_ask) {
          const _subs2 = _gs.subjectTerms ? _gs.subjectTerms(query) : []
          const _numRe = /[0-9０-９]|[一二三四五六七八九十百千万两]/
          const _nameRe = /[A-Za-z]{2,}|[「『""“][^，。、；：！？」』""”]{1,12}[」』""”]/
          let _hasNum = false
          let _hasName = false
          let _scanned = 0
          // 2026-11-20：问「换了几块硬盘」，条目里写着「八天吊针」也放行——单位对不上。
          // 问句里带了单位，就要求「数字紧挨着同一个单位」才算答了数值。
          const _uList = (String(query || '')
            // 2026-11-20：「每天」「今天」里的「天」不是要问的单位，先抹掉，再认单位；
            // 另外补上「点」——问几点送到，答案就是「七点」。
            .replace(/每[天日年周月]|天天|今天|昨天|明天/g, '')
            .match(/块|赫兹|hz|组|次|点|时|小时|分钟|天|万|亿|斤|岁|楼|层|号|度|米|公里|个|只|条|套|瓶|杯|元/gi) || [])
          // 问「刷新率」的，答案里通常写成 60Hz / 六十赫兹——把这两个单位也算上。
          if (/刷新率/.test(String(query || ''))) _uList.push('hz', '赫兹')
          for (const x of scored.slice(0, 8)) {
            const hay = String((x.p && x.p.title) || '') + ' ' + String((x.p && x.p.text) || '')
            for (const s of _subs2) {
              let from = 0
              for (let k = 0; k < 3; k++) {
                const at = hay.indexOf(s, from)
                if (at < 0) break
                const _vw = Number(tuning().valueWin ?? 24)
                const win0 = hay.slice(Math.max(0, at - _vw), at + s.length + _vw)
                // 日期与时间戳不算值：2026-11-13、22:11 这类满篇都是
                const win = win0.replace(/\d{4}[-/年.]\d{1,2}([-/月.]\d{1,2})?/g, ' ').replace(/\d{1,2}[:：]\d{2}/g, ' ')
                if (_numRe.test(win)) {
                  if (!_uList.length) _hasNum = true
                  else if (_uList.some((u) => new RegExp('[0-9０-９一二三四五六七八九十百千万两]\\s*' + u, 'i').test(win))) _hasNum = true
                }
                _scanned++
                if (_nameRe.test(win0)) _hasName = true
                from = at + s.length
                if (_hasNum && _hasName) break
              }
              if (_hasNum && _hasName) break
            }
            if (_hasNum && _hasName) break
          }
          // 2026-11-21：问句里有「为什么/怎么」这种问原因的句子，问句里的「几点」是转述，不是要一个数值；
          // 主体词一个都没撞上时窗口一次没扫，_hasNum 必假，于是把写着「下午3点」的条目判成没记过。
          // 只放宽这一种，专名那条一律不放（放了会让否定题从 41/41 掉到 36/41，实测过）。
          if (!_scanned && _ask === 'num' && _uList.length && /为什么|怎么|咋/.test(String(query || ''))) {
            for (const x of scored.slice(0, 3)) {
              const hay = String((x.p && x.p.title) || '') + ' ' + String((x.p && x.p.text) || '')
              if (_uList.some((u) => new RegExp('[0-9０-９一二三四五六七八九十百千万两]\\s*' + u, 'i').test(hay))) { _hasNum = true; break }
            }
          }
          // 要专名的，只认专名；要求数字的，只认数字——别互相顶替
          if (_ask === 'num' ? !_hasNum : !_hasName) { _shapeRefuse = true; _shapeKind = 'value' }
        }
      }
    } catch {}

    // 遗忘痕迹：结果不实在的时候，去看看沉下去的那批。
    // 为什么要有：归档之后检索直接跳过，于是「记得但想不起来」和「从来没记过」一模一样。
    // 只补一句人话，不把条目翻出来——翻出来就等于没沉。2026-11-11 深夜。
    let _sunken = ''
    try {
      const _whyOf = (x) => (Array.isArray(x.why) ? x.why.join(' ') : '')
      const _weak = !scored.length || scored.every((x) => /语义保底|直扫救回|没这个值/.test(_whyOf(x)))
      const _q = String(query || '').trim()
      // 原来只在"结果虚"时提示。2026-11-15 改成：只要问的这串字在归档条目里原样出现过，
      // 就提一句——不然归档那批和"从没记过"看起来一模一样（#127 那几条就是这么被当成丢了）。
      if ([..._q].length >= 3 || (_weak && [..._q].length >= 2)) {
        const _arch = (data.points || []).filter((x) => x.archived && !x.dead
          && (String(x.title || '') + String(x.text || '')).includes(_q))
        if (_arch.length) {
          const _x = _arch.sort((a, b) => (Number(b.archivedAt) || 0) - (Number(a.archivedAt) || 0))[0]
          const _d = Math.max(1, Math.round((Date.now() - (Number(_x.archivedAt) || Date.now())) / 86400000))
          const _why = String(_x.archivedWhy || '').trim()
          _sunken = '\n（这块我记着有过东西：「' + String(_x.title || '').slice(0, 24) + '」，' + _d + ' 天前沉下去了'
            + (_why ? '。当时收它的理由：' + _why.slice(0, 30) : '')
            + '。要翻出来就说「把 #' + _x.id + ' 捞回来」）'
        }
      }
    } catch {}

    let _objNote = ''
    try {
      const _ob = await import(new URL('./objects.js?v=' + Date.now(), import.meta.url).href)
      const _lex = _ob.buildLexicon(((data && data.points) || []).map((p) => ({ p })))
      const _rp = _ob.repairQuery(query, _lex)
      if (_rp.note) { _objNote = _rp.note; query = _rp.query }
    } catch {}
    // 显式的缺口：问句里指名了「那台 XX」，而候选里一次都没出现这个词——直说没记过。
    // 不许拿人名顶上：这正是配对评测里反例全挂的原因。2026-11-17 夜。
    try {
      // 跟幽灵闸共用同一个总开关：关掉时回到旧行为，不许偷偷拒。
      if (String(process.env.C2_GHOST_REFUSE || '') === '0') throw new Error('off')
      const _gp = await import(new URL('./gap.js?v=' + Date.now(), import.meta.url).href)
      // 要对整片海问「有没有这件东西」——只看前八条会把真记得的误拒了。
      const _seaPts = ((data && data.points) || []).map((p) => ({ p }))
      const _ref = _gp.gapRefusal(query, _seaPts, (x) => String((x.p && x.p.title) || '') + String((x.p && x.p.text) || '') + String((x.p && x.p.alias) || ''))
      if (_ref) {
        // 2026-11-21：缺口这张嘴太快——「咬抖音多少播放」被答「没记过」，可库里明明有《…咬抖音Logo》。
        // 先问一句「这事记着吗」：记着就说「有这事、没这个细节」，别一口咬定没记过。
        const _nearG = (await import(new URL('./subject.js?v=' + Date.now(), import.meta.url).href)).subjectHit(query, (data && data.points) || [])
        if (_nearG) {
          noteRefusal(sea, query, 'gap-near')
          const _kn = (await import(new URL('./refusal.js?v=' + Date.now(), import.meta.url).href)).knownNoDetail(query, _nearG)
          return { ok: true, logId, log: _kn, conf: 'none' }
        }
        // 2026-11-21：光说「没记过」太硬。先拿「标题里也含这几个两字词」的条目问一句
        // 「是不是这条」——认了就是命中，不认再拒。这是通法，不含任何具体题面。
        try {
          const _q5 = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
          const _g5 = []
          for (let i = 0; i + 2 <= _q5.length; i++) _g5.push(_q5.slice(i, i + 2))
          const _titles = ((data && data.points) || []).filter((p) => !p.dead && !p.archived).map((p) => String(p.title || ''))
          const _df = (g) => _titles.filter((t) => t.includes(g)).length
          let _cand = null
          let _candScore = 0
          for (const p of ((data && data.points) || [])) {
            if (!p || p.dead || p.archived) continue
            const tt = String(p.title || '')
            let sc = 0
            for (const g of _g5) { const d = _df(g); if (d > 0 && d <= 2 && tt.includes(g)) sc++ }
            if (sc > _candScore) { _candScore = sc; _cand = p }
          }
          const _timeQ = /哪一年|几几年|什么时候|几月|几号|多久/.test(String(query || ''))
          const _hard = /密码|电话|手机号|微信号|身份证/.test(String(query || ''))
          if (_cand && _candScore >= (_hard ? 2 : 1) && !_timeQ) {
            noteRefusal(sea, query, 'gap-confirm')
            return { ok: true, logId, log: '你说的是不是《' + String(_cand.title || '') + '》？' + (/哪一句|哪句话|哪句/.test(String(query || '')) ? '〔这条只是挨着：你要的那句原话，未必在这条里〕' : '') + '\n（是它我就细说；不是的话，给我个大概时候或者换个叫法，我再找。）', conf: 'low' }
          }
        } catch {}
        noteRefusal(sea, query, 'gap')
        return { ok: true, logId, log: _ref }
      }
    } catch {}
    // 2026-11-21：问「我妈叫什么名字」这种，库里根本没这个说法，却把不相干的两条当「对上」摆出来。
    // 名字题先把问的那个人/东西抠出来：库里一条都没提过它，就老实说没记过，别拿别的名字顶上。
    try {
      if (/叫什么名字|名字叫什么|叫啥名/.test(query)) {
        const _subName = String(query).replace(/叫什么名字|名字叫什么|叫啥名|名字/g, '').replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 2)
        if (_subName.length >= 2) {
          const _anyName = ((data && data.points) || []).some((p) => (String(p.title || '') + String(p.alias || '') + String(p.text || '')).includes(_subName))
          // 2026-11-21 十六点三二：这条闸忘了看总开关——关掉拒答它照样拒，就是那条红。
          // 开关关着就放行，别自作主张。
          if (!_anyName && String(process.env.C2_GHOST_REFUSE || '1') !== '0') {
            noteRefusal(sea, query, 'name-subject')
            return { ok: true, logId, log: notRecorded(query), conf: 'none' }
          }
        }
      }
    } catch {}

    // 接话：你说到这儿，我顺嘴提一句——只看你问的字，不看时间，十分钟最多一次。
    let _aside = ''
    let _contact = ''
    try {
      _aside = asideFor(scored[0] && scored[0].p ? scored[0].p.id : 0, data, scored.slice(0, limit).map((x) => x.p && x.p.id))
      const _ct = await import(new URL('./contact.js?v=' + Date.now(), import.meta.url).href)
      const _r = _ct.pickFollowUp(query, data, scored.slice(0, limit).map((x) => x.p && x.p.id), Date.now(), _lastContactAt)
      if (!_aside && _r.line) {
        _contact = _r.line
        _lastContactAt = _r.at
        try { writeFileSync(_contactFile, JSON.stringify({ at: _r.at }), 'utf8') } catch {}
      }
    } catch {}
    const _topWhy = scored[0] && Array.isArray(scored[0].why) ? scored[0].why.join(' ') : ''
    // 有一条命中够硬，就不算「凑出来的」——命中和分数都看一眼（2026-11-18 夜）
    // 库里没向量（没模型包/没建索引）：一定是在硬找，别装作有底（2026-11-18 夜）
    let _noVec = false
    try { _noVec = !(qv && qv.length) || !(vmap && vmap.size) } catch {}
    const _strong = !_noVec && !/直扫救回/.test(_topWhy) && scored.some((x) => {
      if ((Number(x.hit) || 0) >= 3) return true
      if ((Number(x.score) || 0) >= 0.55) return true
      // 语义相似度过半，也算找到了：语义 0.51 那种（2026-11-18 夜）
      const w = Array.isArray(x.why) ? x.why.join(' ') : ''
      // 2026-11-20：这两个正则原来是双反斜杠——在 JS 里等于「匹配一个真的反斜杠」，
      // 拿「语义 0.51」去试永远认不出，于是「语义过半也算找到了」这条从来没生效过，
      // 结果就是正常命中被当成虚的、多给一句「标一下」。改回单反斜杠。
      const m = w.match(/语义\s*(\d\.\d+)/g) || []
      // 2026-11-21：本机的「语义分」是字典哈希，不是真模型——它不该单独把一条判成「够硬」。
      // 这里不再拿 0.5 就算数；真模型接回来之前，只当弱信号。
      return m.some((s) => Number((s.match(/(\d\.\d+)/) || [])[1] || 0) >= 0.9)
    })
    const _noSem = scored.length > 0 && scored.every((x) => !/语义/.test(Array.isArray(x.why) ? x.why.join(' ') : ''))
    const _weakHint = _noVec || _noSem || (!_strong && (!scored.length || /没这个值/.test(_topWhy) || scored.every((x) => {
      const w = Array.isArray(x.why) ? x.why.join(' ') : ''
      return /语义保底|直扫救回|没这个值/.test(w)
    })))

    // 语义闸：像不像；默认只标不确定，不拒答（开多少看环境变量）
    let _uncNote = ''
    // 原来是「不沾边就拒答」，现在默认改成标注
    try {
      // 默认门槛零点零五：低于它只标不确定，不拒（2026-11-19）
      const _th = String(process.env.C2_REFUSE_COS ?? '') === '0' ? 0 : Number(process.env.C2_REFUSE_COS ?? 0.05)
      if (_th > 0 && scored.length) {
        const E = await import('./embed-js.js')
        const p0 = scored[0].p || {}
        const txt = String(p0.title || '') + ' ' + String(p0.text || '')
        const c = E.cosine(E.embed(query), E.embed(txt))
        const RC = await import('./refusecos.js')
        if (RC.shouldRefuseCos(c, _th)) {
          // 默认不拒答，只标一句不确定：拒掉会连对的一起丢（2026-11-19）
          if (String(process.env.C2_UNCERTAIN || '1') === '1') _uncNote = '\n（这条我没太大把握，你再确认一下。）'
          else return { ok: true, logId, log: notRecorded(query), conf: 'none' }
        }
      }
    } catch {}

    // 问的是一个具体值、库里又没有，就直说没记过——别拿沾边的一条顶上（2026-11-19）
    // 2026-11-19：形状闸也归同一个总开关——C2_GHOST_REFUSE=0 时一律不拒，别偷偷动手。
    if (process.env.C2_TRACE_REFUSE) console.error('[refuse-check] shapeRefuse=' + _shapeRefuse + ' kind=' + (_shapeKind || '-'))
    // 2026-11-21：灰区那道缝——问的是细节值（多少/哪句/什么牌子），库里没这个值，
    // 但「这事」记着（问句里的实词撞上过某条）。这时候说「没记过」是撒谎，
    // 改成「有这事、没这细节」，并把最像的那条标题点出来。
    if (_shapeRefuse && String(process.env.C2_GHOST_REFUSE || '1') !== '0') {
      // 判据收到 lib/subject.js：问句里连续三个字以上原样出现在库里同一条，才算这事记着。
      const _near = (await import('./subject.js')).subjectHit(query, (data.points || []))
      if (!_near) {
      // 同一套「是不是这条」的追问，接到形状闸这边来：拒之前先给最像的一条让人认领。
      try {
        const _q6 = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
        const _g6 = []
        for (let i = 0; i + 2 <= _q6.length; i++) _g6.push(_q6.slice(i, i + 2))
        const _alive = ((data && data.points) || []).filter((p) => p && !p.dead && !p.archived)
        const _t6 = _alive.map((p) => String(p.title || ''))
        let _c6 = null
        let _cs6 = 0
        for (const p of _alive) {
          const tt = String(p.title || '')
          let sc = 0
          for (const g of _g6) {
            const df = _t6.filter((x) => x.includes(g)).length
            if (df > 0 && df <= 2 && tt.includes(g)) sc++
          }
          if (sc > _cs6) { _cs6 = sc; _c6 = p }
        }
        const _timeQ6 = /哪一年|几几年|什么时候|几月|几号|多久/.test(String(query || ''))
        const _hard6 = /密码|电话|手机号|微信号|身份证/.test(String(query || ''))
        if (_c6 && _cs6 >= (_hard6 ? 2 : 1) && !_timeQ6) {
          noteRefusal(sea, query, 'shape-confirm')
          return { ok: true, logId, log: '你说的是不是《' + String(_c6.title || '') + '》？' + (/哪一句|哪句话|哪句/.test(String(query || '')) ? '〔这条只是挨着：你要的那句原话，未必在这条里〕' : '') + '\n（是它我就细说；不是的话，给我个大概时候或者换个叫法，我再找。）', conf: 'low' }
        }
      } catch {}
      const _soft = softNoDetail(query, (data && data.points) || [])
      noteRefusal(sea, query, _soft ? 'shape-soft' : (_shapeKind || 'shape'))
      return { ok: true, logId, log: _soft || notRecorded(query), conf: _soft ? 'low' : 'none' }
    }
      // 问的是值、库里没这个值——不端条目，只把话说成「有这事、没这细节」。
      // 自检里「数值题单位对不上」那条盯的就是：不能拿别的数顶上。
      noteRefusal(sea, query, 'shape-near')
      try {
        const R2 = await import('./refusal.js')
        return { ok: true, logId, log: R2.knownNoDetail(query, _near), conf: 'none' }
      } catch {}
    }

    // 2026-11-19：置信度三档。阈值不是拍的，是 370 题分桶量出来的（见 docs/评测-topk.md）：
    //   相对分 ≥0.8 → 头名对 99.1%；0.4–0.8 → 94.6%；<0.4 → 只有 33–67%。
    // 低档不在正文里加噪音，只在结果字段里标，页面/调用方自己决定怎么显示。
    let _conf = 'low'
    try {
      const _r0 = Number((scored[0] && scored[0].rel) || 0)
      const _T = tuning()
      _conf = _r0 >= Number(_T.confHigh ?? 0.8) ? 'high' : _r0 >= Number(_T.confMid ?? 0.4) ? 'mid' : 'low'
    } catch {}

    return {
      ok: true,
      logId,
      conf: _conf,
      log: _ambNote + openLineFor(query, Math.min(limit, scored.length), Date.now(), moodTone())
        + '\n' + _nowNote + _supNote + recalledBefore(query, sea, Date.now(), null) + lines.join('\n') + bodyNote + vectorNote + _sunken + _uncNote
        + _aside + _contact + _objNote + _verdictNote + _weakNote + _timeNote
        // 结果虚的时候提醒标一次：没有标注，召回率永远算不出来。
        // 只在"全是保底"时加，正常命中不加——不然每轮都多一句噪音。2026-11-11 深夜。
        + (_weakHint
          ? '\n（这次是直扫找的、没走语义。用上了就 memory_judge 标一下' + (logId ? '，logId=' + logId : '') + '；没对上就标 miss。）'
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
      q: { type: 'string', description: '刚才问的那句话；判错要落盘就靠它' },
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
    // 2026-11-21：判 miss / wrong 却没说该是哪一条时，以前照样落盘，写出「expect 0、got 0、判定错」
    // 这种自相矛盾的行——拿它训练等于教模型「零号是标准答案」。这两档必须带上编号。
    if ((v === 'miss' || v === 'wrong') && !Number(args && args.expect_id)) {
      return { ok: false, log: '判 ' + v + ' 得说一下该翻到哪一条（expect_id）——不说的话这条数据自相矛盾，我不写。' }
    }
    const ok = judgeSearch({
      logId: id,
      verdict: v,
      expectId: Number((args && args.expect_id) || 0) || null,
      note: String((args && args.note) || ''),
    })
    if (!ok) return { ok: false, log: '记不进去，可能是日志文件写不了。' }
    // 判错就回流：把这一问、该是哪条、实际给了哪条记下来，给训练攒硬负样本。
    // 判错就回流：问的是什么从审计里倒着找（检索可能提前返回，内存变量记不到）
    let _fbOk = false
    try {
      if (v !== 'hit') {
        const F = await import('./feedback.js')
        const q = String((args && args.q) || '') || F.lastSearchQuery(String((args && args.sea) || 'main')) || String((args && args.q) || '')
        if (q) {
          _fbOk = F.appendFeedback({
            q,
            expect: Number((args && args.expect_id) || 0),
            got: 0,
            verdict: v,
            sea: String((args && args.sea) || 'main'),
          })
        }
      }
    } catch {}
    if (v !== 'hit' && !_fbOk) return { ok: false, log: '这次判错没落盘——要落盘就把刚才的问句一起给我。' }
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
      // 2026-11-20：边在库里存的是 from/to，这儿按 a/b 认——一条都对不上，
      // 「跟谁连着」永远是空的。两种写法都认，认不出就跳过。
      const _ea = e.a !== undefined ? Number(e.a) : Number(e.from)
      const _eb = e.b !== undefined ? Number(e.b) : Number(e.to)
      if (_ea !== id && _eb !== id) continue
      // 上一行已经把两端的写法抹平了，这里也用抹平后的：不然又回到「认不出」。
      const oid = _ea === id ? _eb : _ea
      const o = (data.points || []).find((x) => Number(x.id) === Number(oid))
      if (!o) continue
      // 权重字段也一并认：库里边用的是相似度，早先这里读的是另一个名字。
      neighbors.push({ title: o.title, w: Number(e.w ?? e.sim ?? 0), type: e.type || 'related' })
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
      const ok = writeChecked(sea, data, 'tool-main')
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
      // 2026-11-20：写盘回执原来不看——写不进去照样回「归档了 N 条」。
      // 实测：把库设成只读再捞一条，回执说「捞回来了」，库里还是沉的。
      if (!writeChecked(sea, data, 'tool-main')) {
        return { ok: false, log: '写盘失败，没归档（库里没动）。' }
      }
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
      if (!writeChecked(sea, data, 'tool-main')) {
        return { ok: false, log: '写盘失败，没捞回来（库里没动）。' }
      }
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
    return `桌面上的副本换了 ${n} 份`
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
  // 2026-11-21：这句原来写着「工具几个、路由几条、测试几份」，可实现只数识海、条数、连线。
  // 说得到做不到，最容易让人拿着一个不存在的数去汇报。改成它真数的那些。
  description: '自己数一遍：识海几个、活着的记忆几条（含沉底共几条）、连线几根，再逐个海列出来。'
    + '要报规模就先调它，别凭印象——2026-11-08 报错过两个版本。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute() {
    // 2026-11-17 改：不再起子进程。
    // 桌面版 process.execPath 是 DeepSeek Harness.exe，不是 node；而 npm 包里也没有 scripts/。
    // 两处一凑，这功能在别人的机器上必然报错。改成自己读盘，当场数。
    try {
      const { readSea } = await import('./store.js')
      const { SEAS_DIR } = await import('./paths.js')
      const { readdirSync, existsSync } = await import('node:fs')
      const { join: joinPath } = await import('node:path')

      let seas = []
      try {
        seas = readdirSync(SEAS_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(joinPath(SEAS_DIR, d.name, 'data.json')))
          .map((d) => d.name)
      } catch {}

      let points = 0
      let edges = 0
      let alive = 0
      const per = []
      for (const id of seas) {
        const d = readSea(id)
        const ps = (d && Array.isArray(d.points)) ? d.points : []
        const es = (d && Array.isArray(d.edges)) ? d.edges : []
        const live = ps.filter((p) => p && !p.dead).length
        points += ps.length
        alive += live
        edges += es.length
        per.push(id + ' ' + live + ' 条 / ' + es.length + ' 根')
      }

      const log = '识海 ' + seas.length + ' 个｜记忆 ' + alive + ' 条（含沉底 ' + points + '）｜连线 ' + edges + ' 根'
        + (per.length ? '\n' + per.join('\n') : '')
      return { ok: true, log }
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
        const dueArg = (args && args.dueAt) ? String(args.dueAt).trim() : ''
        const due = dueArg ? parseWhen(dueArg) : 0
        // 2026-11-20：到期日看不懂时原来是静静存成空——回执照说「记下了」，期限没了。
        // 实测：写「下周三」→ 回执成功、库里到期是空的。这条得拦下来，跟钉时间那支一个态度。
        if (dueArg && !due) {
          return {
            ok: false,
            log: '到期时间没看懂：「' + dueArg + '」。可以写「2026-11-25」「11-25 晚上」「今天」「昨天」。'
              + '\n（不想设期限就别填这一栏。）',
          }
        }
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
        const ok = writeChecked(sea, data, 'tool-main')
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
        const ok2 = writeChecked(sea, data, 'tool-main')
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
      // 2026-11-20：这儿直接从环境里取用户目录，别的工具早统一用同一个家目录。
      // 那变量没定义时（非 Windows、被清掉的服务环境）路径会变成本地相对路径，读的是当前目录，
      // 实测直接 ENOENT。改回统一的家目录。
      const file = path.join(HOME, '.dsh', 'consciousness-seas', sea, 'data.json')
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

export const importTool = {
  name: 'memory_import',
  description:
    '把 memory_export 导出的那批 Markdown 读回来，写成一个新的识海。'
    + '用户说「把导出的记忆装回来」「换个识海还原那些文本」时用这个。'
    + '目标识海必须不存在或为空，有记忆就拒绝，绝不覆盖。',
  parameters: {
    type: 'object',
    properties: {
      sea: { type: 'string', description: '源：导出时的识海名，不填就是 main' },
      to: { type: 'string', description: '目标：导进哪个新识海（自己起个名）' },
    },
    required: ['to'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, log: { type: 'string' } } },
    render: (_a, v) => text(v && v.log),
  },
  async execute(args = {}) {
    const from = (args && args.sea) || 'main'
    const to = args && args.to
    try {
      const { importMirror } = await import('./mirror-import.js')
      const r = importMirror(from, to)
      if (!r.ok) return { ok: false, log: '装不回来：' + (r.err || '不知道哪一步坏了') }
      const head = '装回来了 ' + r.n + ' 条，在新识海「' + to + '」里'
      const tail = r.skipped ? '\n有 ' + r.skipped + ' 份没读出来：' + (r.skippedList || []).join('；') : ''
      return { ok: true, log: head + '\n位置：' + r.dir + tail }
    } catch (e) {
      return { ok: false, log: '导入出错：' + String((e && e.message) || e) }
    }
  },
}

/** 记粗：底气不足的那条，说话带「印象里」「可能记岔了」，不硬装一字不差。 */
export function vagueFor(p) {
  try {
    if (!p) return { prefix: '', suffix: '' }
    const c = Number(p.confidence)
    const lowConf = Number.isFinite(c) && c < 0.6
    const lowTime = p.bornEstimated === true
    // 得说清「哪一处松了」：时间松、还是细节松。两样都松就都标出来。
    // 指不出松在哪儿的，就不许含糊——那会变成拿含糊当挡箭牌。2026-11-17 夜。
    if (lowTime && lowConf) return { prefix: '印象里，', suffix: '（时间估的，细节也可能记岔）' }
    if (lowTime) return { prefix: '', suffix: '（时间大概记得）' }
    if (lowConf) return { prefix: '印象里，', suffix: '（细节可能记岔了）' }
    return { prefix: '', suffix: '' }
  } catch {
    return { prefix: '', suffix: '' }
  }
}
// 池子入口：整条检索搬到子线程并行；出错就退回本线程
if (typeof searchTool === 'object' && typeof searchTool.executeInline === 'function') {
  const _inline = searchTool.executeInline.bind(searchTool)
  searchTool.execute = async function (args) {
    if (process.env.C2_IN_WORKER) return _inline(args)
    if (process.env.C2_SEARCH_POOL !== '1') return _inline(args)
    try {
      const pool = await import('./searchpool.js')
      return await pool.search(args)
    } catch {
      return _inline(args)
    }
  }
}

// 跨海检索：先每个海粗筛几条，挑翻到最多的两个海再精排（2026-11-18 夜）
if (typeof searchTool === 'object' && typeof searchTool.execute === 'function') {
  const _one = searchTool.execute.bind(searchTool)
  searchTool.execute = async function (args) {
    if (!(args && Array.isArray(args.seas) && args.seas.length > 1)) return _one(args)
    const seas = args.seas.map(String).filter(Boolean).slice(0, 8)
    const per = Math.max(1, Math.min(5, Number(args.perSea) || 3))
    const first = []
    for (const s of seas) {
      try {
        const r = await _one({ ...args, seas: undefined, perSea: undefined, sea: s, limit: per })
        const ids = []
        for (const line of String((r && r.log) || '').split('\n')) {
          const m = line.match(/^· #(\d+)/)
          if (m) ids.push(Number(m[1]))
        }
        first.push({ sea: s, ids, log: String((r && r.log) || '') })
      } catch { first.push({ sea: s, ids: [], log: '' }) }
    }
    const rank = first.filter((x) => x.ids.length).sort((a, b) => b.ids.length - a.ids.length).slice(0, 2)
    const seen = new Set()
    const lines = []
    for (const r of rank) {
      let rr = r
      try {
        const deep = await _one({ ...args, seas: undefined, perSea: undefined, sea: r.sea, limit: Math.max(per, Number(args.limit) || 6) })
        rr = { sea: r.sea, log: String((deep && deep.log) || '') }
      } catch {}
      for (const line of String(rr.log || '').split('\n')) {
        const m = line.match(/^· #(\d+)/)
        if (!m) continue
        const key = rr.sea + '#' + m[1]
        if (seen.has(key)) continue
        seen.add(key)
        lines.push(line + '（' + rr.sea + '）')
      }
    }
    const lim = Math.max(1, Math.min(12, Number(args.limit) || 6))
    return {
      ok: true,
      log: lines.length
        ? '跨 ' + rank.map((x) => x.sea).join(' · ') + ' 找的：\n' + lines.slice(0, lim).join('\n')
        : '这几个海里都没翻到跟「' + String(args.query || '') + '」对得上的。',
    }
  }
}
