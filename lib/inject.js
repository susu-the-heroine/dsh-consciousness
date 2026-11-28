/**
 * 对方怎么称呼（2026-11-08）：配置里写了就用名字，没写就"他"。
 * 你自己的机器上该有你的名字；别人装上不能用你的名字——所以走配置，不写死。
 * 配置：~/.dsh/consciousness-user.json  {"name":"苏苏侠"}
 */
function _hisName() {
  try {
    const p = join(homedir(), '.dsh', 'consciousness-user.json')
    const raw = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
    const j = JSON.parse(raw)
    const n = String((j && j.name) || '').trim()
    if (n && n.length <= 12) return n
  } catch {}
  return '他'
}

/**
 * 自动注入
 * ========
 *
 * 每轮把「她记得什么」递进上下文。这是整套东西的心脏——
 * 没有这一层，记忆就只是个能查的库，不是「她记着你」。
 *
 * 走 systemPrompt.context()，不走 section()：
 *   section 拼进系统提示词，一变整段缓存全废（成本 ×20）
 *   context 追加到对话末尾，只有内容变了才追加，缓存一直命中
 *
 * 这是 dsh-fish-memory 用两次实测换来的经验，直接照抄。
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { classifyIntent } from './intent.js'
import { shouldSpeak, markSpoken } from './suppress.js'
import { autoThinkOnce, shouldThinkNow, readThoughts } from './thinkauto.js'
import { kindOf, learnWord, candidateWord } from './emowords.js'
import { pickStance } from './stance.js'
import { tuning, expandTerms } from './tuning.js'
import { spontaneousOf, canThinkNow } from './spontaneous.js'
import { readSea, writeSea, backupSea, readMeta } from './store.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { audit } from './log.js'
import { SEAS_DIR } from './paths.js'
import { project as projectDims, describeDims } from './emotion-lexicon.js'
import { blend as blendDims, suppress as suppressDims, towardBaseline as towardBase, isImpact as isImpactDims, applyAbsence } from './dynamics.js'
import { BASELINE as SELF_BASELINE } from './tick.js'
import { markText, timeConfidenceOf, contentConfidenceOf } from './uncertainty.js'
import { isOn as selfModeOn, readMode } from './selfmode.js'
import { recordDims } from './moodline.js'
import { todayActivity } from './activity.js'
// 2026-11-24 夜：「她这会儿」改成一整句人话，唯一来源 moodword.sentenceOf
import { sentenceOf } from './moodword.js'
// 2026-11-24 夜：把模型判定接进主链路。注入是同步的，所以模型在「他这句话到达时」异步预取，
// 注入时同步读缓存——跟向量预取同一个套路（2048 行那里）。
import { judge as judgeByModel, isAvailable as modelReady, BUCKETS as MODEL_BUCKETS } from './feel-head.js'
import { listThoughts } from './selfmind.js'
// 2026-11-20：下面「她心里挂着」那段用了 collect，可这里只导了三个，collect 没导——
// 每轮抛 ReferenceError、被外层 catch 吞掉，那段从来没出现过。
import { topItems, describeItem, markInjected, collect } from './preoccupations.js'
import { identityLine } from './identity.js'
import { describeRelation, statsFrom } from './relation.js'
import { conflictsOf, describeConflict } from './conflict.js'
import { recordToday, recentHistory, describeHistory } from './relationlog.js'
import { introversion, describeIntroversion } from './introversion.js'
import { yearning, estrangement, describeAbsence } from './absence.js'
import { gramsOf } from './text.js'
import { buildCanon as buildEntityCanon, expandEntity as expandEntityName } from './entity-alias.js'
import { assertRules, noteRules, noteCompaction, noteHostError } from './compaction.js'

// 宿主压缩计数器：compaction/end 监听器每触发一次 +1，
// buildText 发现变了就丢本地字面缓存重算（清单第 12 件）。
let _compactionTick = 0
import { loadVectors, embedQuery, cosine } from './vectors.js'
import { buildEntityIndex as _fuseEntIdx, matchEntities as _fuseEntMatch } from './shihai-fuse.js'
import { byDecay, decayOf } from './decay.js'
import { qualityRank, qOn } from './quality.js'
import { appendRaw } from './evidence.js'
import { sweepArchive } from './archive.js'
import { seaForSession, seaOfSession, bindSession } from './session.js'
import { empathyOf } from './empathy.js'
import { allowSwear, swearLine } from './rage.js'
import { isBanter, isSarcasm } from './banter.js'
import { rememberVerdict, takeVerdict, observe } from './banter-learn.js'
import { recordReply, takeWarning, shouldRetry, markRetry } from './replycheck.js'
import { styleCandidates, markStyleUsed } from './style-store.js'
import { selectForInject } from './styleharvest.js'
import { maybeHarvest, nextTurn } from './style-tick.js'
import { shouldRun, recordCost } from './style-breaker.js'
import { selfForInject, selfDue, selfHints } from './self-note.js'
import { draftFor, missDraft } from './self-draft.js'
import { retryMode } from './retry-mode.js'
import { readHeart, writeHeart, tickHeart, defaultMood, applyMood, judgeEmotion, EMO_TO_MOOD } from './mood.js'
import { temperamentOf, toneFor, toneForKey, underToneFor } from './temperament.js'
import { EMOTIONS, decayMix, dominant, padOf, octantOf, say, pairOf, describe } from '../assets/emotion.js'
import { capParts } from './cap.js'
import { mixByDamp, readDamp, describeDamp } from './damping.js'

// 2026-11-19（清单 P35）：这三个缓存原来全文没有声明，每轮必抛 ReferenceError，
// 又被外层 catch 吞掉——所以「跟这句有关的」那一层永远空着，pick-log 也停在 11-15。
// 条数没变就复用统计；缓存里记着压缩轮次，压缩后自动作废。
const _dfCache = { n: -1, at: 0, df: new Map(), tick: -1 }
const _gCache = new Map()
let _lastLogged = { q: '', at: 0 }

// 注入到 DSH 页面的那一行：动态加载挂件脚本。桌面端唯一能生效的通道。
// 2026-11-28（他点名的）：那个小浮窗就是这里的 widget.js 插进去的。
// 关掉只写 sessionStorage，重启就清空，所以每次开机又冒出来，还拖机器。
// 他不要了，这一行直接关掉。要恢复把下面 INJECT_TEXT 换成原来那版即可。
export const INJECT_TEXT = ''
const _INJECT_WIDGET_OLD =
  '(function(){try{var d=document.body||document.documentElement;if(!d)return;' +
  'if(!document.getElementById("dsh-sea-script")){' +
  'var s=document.createElement("script");s.id="dsh-sea-script";' +
  's.src="/dsh-consciousness/widget.js";s.onerror=function(){};d.appendChild(s)}' +
  // 动态壁纸也一起挂上：dsh-sea-skin 不在 bundles 里，但它那 10MB 的视频是好的，
  // 走识海自己的路由发出去，前端脚本也由识海发。
  '}catch(e){}})()'

/**
 * 她自己想起一件事。
 *
 * 跟页面那个 /consciousness/recall 是同一套挑法（七成挑太久没碰的、三成挑最近常想起的），
 * 区别只有一个：这个不靠页面开着。DSH 一起，它就在后台每 20 分钟想一次。
 *
 * 想起来的东西写进心脏（lastThought + thoughts），注入那段【她最近想起过】会带出去。
 * 同一个标题 12 小时内不重复想，免得翻来覆去就那几条。
 */
// 2026-11-20：原来写死读主海。会话绑到别的高海时，它仍从主海挑条目——多海用会串。
// 现在收一个海名，默认主海，调用方按当前会话绑定传进来。
export function tryAutoRecall(sea = 'main') {
  try {
    const now = Date.now()
    // 2026-11-20：读改成了按会话的海，可下面「备份/写回」还写死 main——
    // 多海时一想起，就把这个海的内容整块写进主海，主海原来的条目全被顶掉。
    const _sea = sea || 'main'
    const data = readSea(_sea)
    if (!data || !Array.isArray(data.points)) return null
    let pts = data.points.filter((p) => !p.dead && !p.validUntil && !p.archived)
    if (!pts.length) return null

    // 互斥：今天已经"想"过的那几条，主动想起就绕开。
    // 不绕的话，同一件事会被两条线各提一次——一条说"又想起"，一条说"在想"。
    // 2026-11-11 晚，苏苏侠点出来的。绕完要是空了，就还是用全量，别让它哑了。
    try {
      const _cut = now - 24 * 3600 * 1000
      const _used = new Set(readThoughts()
        .filter((x) => (Number(x.at) || 0) > _cut)
        .map((x) => String(x.seedId)))
      if (_used.size) {
        // 欠着的、没说清的、还缺的，不许排除——那些本来就该反复回到。
        // 之前一刀切，把最该想的东西挡在外面了。2026-11-11 晚，苏苏侠点出来。
        // 只认"显式写下来的状态"，不许从字面猜。
        // "还没说清"是显示时贴的标签，不是记忆里的事实——拿它当证据，
        // 等于我用自己的说法给自己作证。2026-11-11 晚，苏苏侠点出来。
        const _open = (p) => {
          if (p.kind === 'promise' && p.promiseStatus !== 'done') return true
          if (p.open === true) return true
          if (p.status === 'open') return true
          return false
        }
        const _rest = pts.filter((p) => _open(p) || !_used.has(String(p.id)))
        if (_rest.length) pts = _rest
      }
    } catch {}

    const h = tickHeart(readHeart())
    const fresh = new Set(
      (Array.isArray(h.thoughts) ? h.thoughts : [])
        .filter((x) => now - (Number(x.at) || 0) < 12 * 3600 * 1000)
        .map((x) => String(x.title || '').trim())
    )

    // 挑哪条：七成看「最久没提」，三成看「最近提过」。
    // 但光看时间不够——同样久没提的两条，情绪重的那条才该冒出来。
    // 所以两个方向都用同一个分：没提的天数 + 情绪分量。
    const _weight = (p) => {
      const days = p.lastSeen ? (now - Number(p.lastSeen)) / 86400000 : 999
      const mood = (Number(p.arousal) || 0) / 10            // 0~1
      const imp = Number(p.imp) || 0                         // 0~1
      const pulse = (Number(p.recallCount) || 0) >= 2 ? 0.4 : 0
      // 冷却：刚想过的不许连着想。否则情绪最重的那两条会霸着位置反复冒
      const since = now - (Number(p.lastSeen) || 0)
      const cool = since < 2 * 3600000 ? 14 : 0
      return days + mood * 8 + imp * 6 + pulse - cool
    }
    let pool
    if (Math.random() < 0.7) {
      // 最久没提 + 情绪重
      pool = [...pts].sort((a, b) => _weight(b) - _weight(a)).slice(0, 8)
    } else {
      // 最近提过的，同样带情绪分量（免得老是那几条干巴巴的）
      pool = [...pts]
        .filter((p) => (now - (Number(p.lastSeen) || 0)) < 7 * 86400000)
        .sort((a, b) => _weight(b) - _weight(a))
        .slice(0, 8)
      if (!pool.length) pool = [...pts].sort((a, b) => _weight(b) - _weight(a)).slice(0, 8)
    }
    pool = pool.filter((p) => !fresh.has(String(p.title || '').trim()))

    // 表达抑制：浮上来的也未必该说。琐事、氛围冲突、刚说过的，按下去。
    // 规则在 lib/suppress.js，热加载，调阈值不用重启。2026-11-11 晚。
    try {
      let _mood = { polarity: 0, arousal: 3 }
      try {
        const _hh = readHeart()
        _mood = { polarity: Number(_hh.polarity) || 0, arousal: Number(_hh.arousal) || 3 }
      } catch {}
      const _before = pool.length
      const _kept = []
      // 把池子的强弱分布算出来给抑制用：弱的那批让位，强的照说
      let _poolAvg = 0
      try {
        let _s = 0
        for (const _x of pool) {
          const _i = Math.max(0, Math.min(1, Number(_x.imp) || 0))
          const _a = Math.max(0, Math.min(1, (Number(_x.arousal) || 0) / 10))
          _s += _i * 0.6 + _a * 0.4
        }
        _poolAvg = pool.length ? _s / pool.length : 0
      } catch {}
      for (let _idx = 0; _idx < pool.length; _idx++) {
        const _p = pool[_idx]
        const _d = shouldSpeak(_p, _mood, { poolSize: pool.length, rank: _idx + 1, poolAvg: _poolAvg })
        if (_d.speak) _kept.push(_p)
        else { try { audit('suppressed', { id: _p.id, reason: _d.reason }) } catch {} }
      }
      if (_kept.length) pool = _kept
      try { if (_kept.length !== _before) audit('suppress-count', { before: _before, after: _kept.length }) } catch {}
    } catch (e) {
      try { audit('suppress-fail', { err: String((e && e.message) || e).slice(0, 60) }) } catch {}
    }

    if (!pool.length) return null

    // 主动频率闸：用户自己定的档。off 就整段不跑；low/中/多 决定最短间隔。
    try {
      const _lv = spontaneousOf()
      if (!isFinite(_lv.gapMin)) return null
      if (!canThinkNow(h.lastThought && h.lastThought.at)) return null
      // 硬闸：不管谁触发（定时器、每轮注入、接口），两次「想起」之间至少隔 N 分钟。
      // 实测没有这道闸时，一小时冒了 19 条，间隔 1-4 分钟——那不叫想起，叫刷屏。
      // 2026-11-14 修：原来这里用了 buildText 里的局部 _tune，这个函数作用域里根本没有，
      // 每轮必抛 ReferenceError 被下面的 catch 吞掉——这道硬闸从上线起就从没生效过。
      const _tune = tuning()
      const _gap = Number(_tune.recallGapMin) || 12
      const _last = Number(h.lastThought && h.lastThought.at) || 0
      if (_last && (now - _last) < _gap * 60000) return null
    } catch {}

    const pick = pool[Math.floor(Math.random() * pool.length)]
    // 说出口就记一笔：冷却靠这个才算数，不然同一件事一小时里能提三回。
    try { markSpoken(pick, now) } catch {}
    const days = pick.lastSeen ? Math.floor((now - Number(pick.lastSeen)) / 86400000) : -1
    pick.lastSeen = now
    // 自动想起也会写库：先备份，再走统一入口。
    // 2026-11-14 审计：这里原来是裸 writeSea('main', data)，没备份、失败也不报——
    // 写坏了这条 lastSeen 就丢了，20 分钟后同一条又被想起来。
    try { backupSea(_sea) } catch {}
    try {
      const _ok = writeSea(_sea, data)
      if (_ok === false) audit('recall-write-failed', { id: Number(pick.id) || 0 })
    } catch { try { audit('recall-write-threw', { id: Number(pick.id) || 0 }) } catch {} }

    h.lastThought = { title: String(pick.title || ''), at: now, days }
    if (!Array.isArray(h.thoughts)) h.thoughts = []
    const tier = h.energy > 0.55 ? 'warm' : (h.energy > 0.28 ? 'mid' : 'cold')
    h.thoughts.unshift({
      title: String(pick.title || ''),
      days,
      at: now,
      tier,
      e: Math.round((h.energy || 0) * 100),
      src: 'auto',
    })
    if (h.thoughts.length > 30) h.thoughts.length = 30
    writeHeart(h)
    try { audit('auto-recall', { title: String(pick.title || '').slice(0, 22), days }) } catch {}
    return pick
  } catch (e) {
    try { audit('auto-recall-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return null
  }
}

import { tickBody } from './body.js'
import { appendBounded, readLastLine } from './logfile.js'

/** 空识海时注入的一句话：让模型主动开口教对方怎么记。不是给别人看的说明书。 */
/**
 * 空库时的引导，一个会话只给一次（2026-11-13）。
 * 不这么干的话，用户还没想好写什么，每一轮都会被同一句话催一遍。
 * 只记最近五个会话 id，文件丢了最多多发一次，不影响功能。
 */
export function onceForSession(sid) {
  try {
    const file = join(homedir(), '.dsh', 'consciousness-sim', 'onboarding.json')
    let seen = { sids: [] }
    try { seen = JSON.parse(readFileSync(file, 'utf8')) || { sids: [] } } catch {}
    if (!Array.isArray(seen.sids)) seen.sids = []
    if (sid && seen.sids.includes(sid)) return ''
    if (sid) {
      seen.sids.push(sid)
      seen.sids = seen.sids.slice(-5)
      seen.at = Date.now()
      try {
        mkdirSync(join(homedir(), '.dsh', 'consciousness-sim'), { recursive: true })
        writeJsonAtomic(file, seen)
      } catch {}
    }
    return EMPTY_HINT
  } catch (e) {
    // 注入失败不许静默（清单第 7 件）
    try { audit('inject-emptyhint-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
    return ''
  }
}

export const EMPTY_HINT = [
  '【识海 · 还是空的】',
  '这个识海一条记忆都没有。这一轮请主动带一句：告诉对方可以直接说「记住：……」，',
  '举一个具体的例子（身体、习惯这类），一句话就够，别展开讲功能。',
  '对方这一轮说的话里如果有他自己的事，同时用 memory_add 记下来。',
].join('')

/**
 * 头十条时的引导：教它怎么记才像人（2026-11-14）。
 *
 * 为什么加：跑了"养三十天"的原料体检，第 5 条那会儿，
 * 「带数字的具体事」是 0%、规矩也是 0——写进去的全是感想。
 * 那阶段出来的她像背台词的，不是像人。
 *
 * 一个会话只说一次，跟 EMPTY_HINT 一样。
 */
export function earlyHintOnce(sid) {
  return onceForSession(sid + ':early', EARLY_HINT)
}

export const EARLY_HINT = [
  '【记的时候注意】',
  '现在这个识海才几条，怎么写决定她以后像不像人。写具体的事：他哪天说的、几个人、几个数、',
  '他当时那句话是什么意思——不是写感想。感想先别写，等有事实了再谈。',
  '碰到底线（不许提的、不能劝的）就当条记下来，那是她的规矩。',
].join('')

export function mountAutoInject(ctx) {
  const mounted = new Map()   // sid -> off()
  const lastText = new Map()  // sid -> 最后一条用户消息
  const lastVec = new Map()   // sid -> 那条消息的向量（预取，同步注入时用）
  // 2026-11-24 夜：模型判定也预取。key 是那句话本身——换个说法就换一次判定，
  // 不按 sid 存，免得「上一句的判定」被下一句借用。
  const modelMood = new Map() // 那句话 -> { bucket, conf, at }
  const turnCount = new Map() // sid -> 这个会话聊了多少轮（交接用）
  const lastRawRef = new Map() // sid -> 这条消息在证据层的位置（写入时挂到记忆上）

  const textOfMessage = (msg) => {
    if (!msg) return ''
    if (typeof msg === 'string') return msg
    if (typeof msg.text === 'string') return msg.text
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content.map((x) => (x && (x.text || x.content)) || '').join(' ')
    }
    return ''
  }

  const sidOf = (session) => {
    try {
      return String(
        (session && session.header && session.header.id) ||
          (session && session.id) ||
          ''
      ).trim()
    } catch {
      return ''
    }
  }

  /* 把一条记忆压成一行：标题 + 半句正文 */
  // 卡片式：编号 + 日期 + 标题 + 摘要，最多 140 字
  // 编号让模型分清「这是几条独立的事」，日期让它别把旧事当新事说
  let _cardNo = 0
  const lineOf = (p, mark) => {
    _cardNo++
    const title = String(p.title || p.titleFull || '').trim()
    const text = String(p.text || '').replace(/\s+/g, ' ').trim()
    // 按码点截断，不切断 emoji（风险文档：UTF-16 截断产生孤立代理位，API 直接 400）
    const chars = [...text]
    const brief = chars.length > 60 ? chars.slice(0, 60).join('') + '…' : text
    // 日期：几天前 / 具体日子
    let when = ''
    try {
      const b = Number(p.born) || 0
      if (b) {
        const days = Math.floor((Date.now() - b) / 86400000)
        // 和检索那边同一套说法：人不说「四天前」，说「前几天」。今天、昨天照旧说准。
        if (days <= 0) when = '今天'
        else if (days === 1) when = '昨天'
        else if (days <= 3) when = '前两天'
        else if (days <= 6) when = '前几天'
        else if (days <= 13) when = '上周'
        else if (days <= 25) when = '大概半个月前'
        else if (days <= 59) when = '上个月'
        else when = new Date(b).getMonth() + 1 + ' 月份'
      }
    } catch {}
    // 日期是估的，就不许写成「4天前」——那是在冒充事实。
    // 改成"大概那阵子"这种相对说法：报个粗档，不装精确。2026-11-15 清单第 18 件。
    try {
      if (when && timeConfidenceOf(p) < 0.5) {
        const b = Number(p.born) || 0
        const days = b ? Math.floor((Date.now() - b) / 86400000) : -1
        if (days >= 0 && days <= 1) when = '大概就这两天'
        else if (days >= 2 && days < 7) when = '大概' + days + '天前那阵子'
        else if (days >= 7 && days < 60) when = '大概' + Math.round(days / 7) + '周前那阵子'
        else when = '时间估的'
      }
    } catch {}

    // 内容本身不确定，也要说出来——只标日期，模型还是会把内容当真
    let contentNote = ''
    try {
      if (contentConfidenceOf(p) < 0.5) contentNote = '（这条内容我不太确定）'
    } catch {}

    // 被想起过几次
    const hits = Number(p.recallCount) || 0
    const hitTxt = hits > 1 ? '（共 ' + hits + ' 次）' : ''
    const head = '[记忆' + _cardNo + ']' + (when ? ' [' + when + ']' : '') + hitTxt
    let line = head + ' ' + title + (brief ? '：' + brief : '')
    // 只记得个标题：明说不全，别让模型照着半条脑补整段
    if (!brief) line += '（这条只记得个大概，就剩这个标题了）'
    // 她当时的感觉：有就带上，这是她自己的那一半
    const hs = p.herSide
    if (hs) {
      const felt = String(hs.felt || '').trim()
      const regret = String(hs.regret || '').trim()
      if (felt) line += '\n     我当时想：' + [...felt].slice(0, 80).join('')
      // 想要什么，是人物立不立得住的关键（2026-11-14）。有就带上，没有不编。
      const wanted = String(hs.wanted || '').trim()
      const did = String(hs.did || '').trim()
      if (wanted) line += '\n     我当时想要：' + [...wanted].slice(0, 60).join('')
      if (did) line += '\n     我实际做了：' + [...did].slice(0, 60).join('')
      if (regret) line += '\n     后来后悔：' + [...regret].slice(0, 60).join('')
    }
    // 后来补的批注：新事让这条的意思变了，批在旁边的那些。
    // 只带最新一条，正文不动（2026-11-14，读数了 A-MEM 的"记忆演化"之后做的）。
    try {
      const ns = Array.isArray(p.notes) ? p.notes.filter((x) => x && String(x.text || '').trim()) : []
      if (ns.length) {
        const last = ns[ns.length - 1]
        const dn = new Date(Number(last.t) || 0)
        const day = Number.isFinite(dn.getTime())
          ? (dn.getMonth() + 1) + '月' + dn.getDate() + '日'
          : ''
        line += '\n     后来补一句' + (day ? '（' + day + '）' : '') + '：' + [...String(last.text)].slice(0, 60).join('')
      }
    } catch {}
    return line
  }

  /* 生成注入文本。必须是同步的——DSH 的 text() 不能 await。 */
  // 给模拟器/自测用：把这一句真的推进她一次，再读结果。
  // 不挂这个，子智能体聊得再热闹也测不到她——那叫自嗨。
  try { globalThis.__dshInjectBuild = (sid, q) => buildText(sid || 'sim', q || '') } catch {}
  // 热措辞：hottext.js 每 30 秒重拿一次。改那个文件，下一轮就生效，不用重启。
  // 之前改一句措辞就得按 cql 重启一次，一晚上十几次。2026-11-11 深夜。
  let HOT_TEXT = null
  const _refreshHot = async () => {
    try { HOT_TEXT = await import(new URL('./hottext.js?v=' + Date.now(), import.meta.url).href) } catch {}
  }
  // 2026-11-20：这个热措辞定时器也没 unref——跟六十秒那个一样，会让引了本文件的进程退不出去。
  try {
    _refreshHot()
    const _hotTimer = setInterval(_refreshHot, 30 * 1000)
    if (_hotTimer && typeof _hotTimer.unref === 'function') _hotTimer.unref()
  } catch {}

  const _lastKind = new Map()   // 上一句判成什么：给学词用
  const _injectSeen = new Set()
  const _injectMemo = new Map()
  const buildText = (sid, query) => {
  // 2026-11-28（群里那份 inject 日志补丁，按本机行号重写）：
  // 原来这一轮没注入时一个字都不写，事后「没注」和「插件没挂上」长得一模一样。
  // 这里只补审计，不碰挑选逻辑；写失败绝不影响注入。
  const _hitLogPath = join(homedir(), '.dsh', 'consciousness-inject.log')
  let _capInfo = null
  const _logSkip = (why, extra) => {
    try {
      appendBounded(_hitLogPath, JSON.stringify(Object.assign({
        t: Date.now(),
        sid: String(sid || '').slice(0, 24),
        n: 0,
        why,
        q: String(query || '').slice(0, 80),
      }, extra || {})) + '\n')
    } catch {}
  }
    // 这一轮有没有被"硬给"过情绪。显示那段读的是本轮开头的 h，
    // 拿不到后面才写进去的 forcedLabel，所以这里单独记一笔。
    let _forcedLabel = ''
    // 2026-11-19（清单 P36/P37）：h0 原来在 try 里 const 声明、块外还在用，抛出被吞，
    // 结果「上一句」和「挂念」两段永远不执行；_prevTalk 也是先用后声明（TDZ）。
    // 两个都提到这里，块内只赋值。
    let h0 = null
    let _prevTalk = null
    try {
      // 每轮推一格情绪。
      // 之前只在「写记忆」和「检索」时推，普通聊天完全不推——
      // 结果就是情绪永远停在初始值，界面上「心情」两个字一年不变。
      try {
        h0 = defaultMood(tickHeart(readHeart()))
        if (query) {
          // 2026-11-23：DSH_EMO2=1 时改走四路合议（appraise.js）。
          // 默认关，走老的 judgeEmotion，一个字节都不变。
          let _judged
          if (process.env.DSH_EMO2 === '1') {
            let _turns = []
            try { _turns = EMO.readWindow(sid || 'default') } catch { _turns = [] }
            let _facts = null
            try {
              const _op = EMO.openPromises('main')
              if (_op && _op.open > 0) _facts = { promised: new Array(_op.open).fill(1), delivered: new Array(Math.max(0, _op.open - _op.overdue)).fill(1), overdue: _op.overdue }
            } catch {}
            let _base = null
            try { _base = EMO.baselineOf(sid || 'default') } catch {}
            const _a = appraise({ text: String(query), turns: _turns, facts: _facts, baseline: _base })
            // 2026-11-24 夜：模型判定接进来（以前 feel-fuse 是死代码，一直没接）。
            // 阈值 0.55 来自 98 条盲标：模型置信 ≥55% 的那 73 条细桶准 79%，<55% 的只有 42%。
            // 预取没赶上（第一条、或者刚重启）就照旧用规则，不许干等。
            let _bucket = _a.bucket
            let _via = 'rule'
            let _mconf = _a.confidence
            try {
              const _hitM = modelMood.get(String(query).trim())
              if (_hitM && _hitM.conf >= 0.55 && MODEL_BUCKETS.includes(_hitM.bucket)) {
                _bucket = _hitM.bucket
                _via = 'model'
                _mconf = _hitM.conf
              }
            } catch {}
            // 2026-11-24 夜：模型十个桶里有五个不在 51 词表里（displeased/urge/tender/low/collapse）。
            // feel() 查不到那个键就直接 return，mix 一个字都写不进去——判得再准也白判。
            // 这五个在这里换成词表里的近亲，写进心脏、显示也用同一个键。
            const MODEL_TO_MIX = { displeased: 'sour', urge: 'impatient', tender: 'soft', low: 'drained', collapse: 'drained' }
            if (_via === 'model' && MODEL_TO_MIX[_bucket]) _bucket = MODEL_TO_MIX[_bucket]
            // 2026-11-24 夜：模型命中时强度也得跟上。
            // 之前只覆盖了桶名、强度还留规则的——规则判 0 就走 applyMood 的提前 return，
            // mix 一条都写不进去，显示那行只能靠八维兜底（实测永远是「心里发空」）。
            const _inten = _via === 'model' ? Math.max(Number(_a.intensity) || 0, _mconf) : _a.intensity
            // dims 不能给空的：applyMood 要从 dims.conduciveness 推怨气，给空等于永远不攒
            const _dims = (_a && _a.dims && typeof _a.dims === 'object') ? _a.dims : {}
            _judged = { mood: _bucket === 'calm' ? 'calm' : _bucket, emoKey: _bucket, intensity: _inten, confidence: _mconf, dims: _dims, emo2: _a, via: _via, ruleBucket: _a.bucket, text: String(query) }
            try { EMO.recordTurn(sid || 'default', 'him', String(query)) } catch {}
          } else {
            _judged = judgeEmotion(String(query))
          }
          // 「麻木」不许被一句话点亮。
          // 实测：「今天天气不错 随便聊聊」被判成 numb(0.45)，于是每句闲聊都在往她身上
          // 浇一层麻木，累瘫从 70% 涨到 95%——那不是她累，是分类器偷懒。
          // 麻木只能是长时间没输入攒出来的（归 absence/tick 管），不是一句话给的。
          // 别用 throw：这一抛会把后面「推【她这会儿】」那一整段一起跳过，
          // 实测整块情绪从注入里消失。把判成麻木的那句**中和掉**就行。
          // 他的情绪 ≠ 她的情绪。
          // 之前直接把他判出来的 key 贴给她：他说"我气死了"，注入里写"她挺生气"。
          // 那不是共情，是复制。这里换成回应：冲她来的火她委屈，冲别的事她跟着急。
          try {
            const _react = empathyOf(_judged, String(query))
            // 给验具留一份内部读数：判出来什么、回应成什么。
            // 本地跑和线上跑不一致时，靠这个看差别在哪，不靠猜。
            try {
              globalThis.__dshLastJudge = {
                q: String(query).slice(0, 40),
                his: { key: (_judged && _judged.emoKey) || '', intensity: Number((_judged && _judged.intensity) || 0) },
                react: { key: (_react && _react.emoKey) || '', intensity: Number((_react && _react.intensity) || 0), note: (_react && _react.note) || '' },
                at: Date.now(),
              }
            } catch {}
            if (_react && _react.emoKey) {
              _judged.emoKey = _react.emoKey
              _judged.intensity = _react.intensity
              _judged.mood = undefined
              // 显示读的是 mix 的残量，上一轮的情绪会压过这一轮的反应。
              // 所以把这一轮的回应**直接写进 mix**，跟"冲击句"一个路子。
              try {
                if (h0 && h0.mix && _react.intensity > 0) {
                  // 2026-11-24 夜：旧值先衰一档再和新反应取大。
                  // 原来直接 Math.max(旧, 新)——旧的永远不下，实测 impatient 卡满五轮不散。
                  const _oldSame = Number(h0.mix[_react.emoKey]) || 0
                  h0.mix[_react.emoKey] = Math.max(_oldSame * 0.55, _react.intensity)
                  // 别的情绪压一档，别让旧的盖住新的
                  for (const k of Object.keys(h0.mix)) {
                    if (k === _react.emoKey) continue
                    h0.mix[k] = (Number(h0.mix[k]) || 0) * 0.6
                  }
                }
              } catch {}
            }
          } catch {}

          if (_judged && _judged.emoKey === 'numb') {
            try { audit('mood-skip-numb', { q: String(query).slice(0, 16), i: _judged.intensity }) } catch {}
            _judged.emoKey = 'calm'
            _judged.intensity = 0
          }
          // 每一句之前先褪一层：不褪就会**只涨不落**——
          // 实测累瘫冲到 100%，人不会有永远 100% 的累，那是水池没出口。
          // 褪得快一点（一句 18%）：说一句累，能累；连说十句，也就那么累。
          try {
            if (h0.mix && typeof h0.mix === 'object') {
              const keep = String((_judged && _judged.emoKey) || '')
              for (const k of Object.keys(h0.mix)) {
                // **这一句点的那种情绪不褪**，别的才褪。
                // 全褪会出事：说一句"累死了"反而更不累（实测 74 → 70），
                // 因为衰减把刚加上去的那层也削掉了。
                // **这一句点的那种情绪褪得慢，别的褪得快。**
                // 2026-11-24 夜改：原来同一种直接 continue 不褪，实测 impatient 卡满五轮不散。
                // 现在它也褪，只是慢一档（0.92 对 0.82），连着急十句才会堆上去。
                const v = Number(h0.mix[k]) || 0
                const nv = v * (k === keep ? 0.92 : 0.82)
                if (nv < 0.02) delete h0.mix[k]
                else h0.mix[k] = nv
              }
            }
          } catch {}

          const _impact = (() => {
            try { return isImpactDims(_judged, String(query)) } catch { return false }
          })()

          // 冲击句不许"没反应"。
          // 实测「我可能要走，以后不来了」被判成 calm(强度0)——最该翻盘的一句，
          // 她情绪一动不动。那不是宽容，是没听懂。
          // 用 PAD 硬给，不靠情绪词表的键名——
          // 实测键名对不上（EMOTIONS 没导出），写 'fear' 等于没写，还是没反应。
          const _forceFear = !!(_impact && (!_judged.intensity || _judged.intensity < 0.2))

          // 惰性：先存住"她进来之前是什么样"，等下算完再按惯性混
          const _before = h0.dims && typeof h0.dims === 'object'
            ? h0.dims
            : projectDims(h0.pad || {})
          if (_forceFear) {
            // 急了、怕了、不甘——"他要走"该是这个反应
            h0.pad = { v: -0.62, a: 0.85, d: -0.55, intensity: 1 }
            // 关键：显示那块只认 mix（51 词的容器）。只改 pad 不改 mix，
            // 数值动了但界面上一个字都不显示——等于白动。
            // scared 在词表里，就用它。
            h0.mix = h0.mix || {}
            h0.mix['scared'] = 0.85
            h0.mixAt = Date.now()
            h0.mood = 'low'
            h0.moodStrength = 0.85
            h0.moodText = '慌了'
            // 2026-11-20：下面那个「硬给的情绪要在标题上写出来」的变量，声明了、读了，
            // 却从来没被赋值——那段兜底等于永远是空字符串。这里补上赋值。
            _forcedLabel = '慌了'
            h0.moodSince = Date.now()
            try { audit('mood-impact-force', { q: String(query).slice(0, 16) }) } catch {}
          } else {
            try { if (_judged && !_judged.text) _judged.text = String(query || '') } catch {}
            applyMood(h0, _judged)
          }
          // 药力落到 PAD 上，再翻成八维——这是"目标"
          const _target = projectDims(h0.pad || {})
          // 惯性七成：不是一句话就把人翻个个儿；除非他真下狠话（说要走、骂到底）
          // 混 → 互相压制 → 每轮只往自己的底色回一点点
          // 惯性不再写死七成：按"她多容易被推"这个数来。
          // 冲击保留特权（能翻盘），平常就是一点点挪。
          let _next
          try {
            const _damp = readDamp()
            _next = mixByDamp(_before, _target, _damp, _impact)
            h0.damp = _damp
            h0.dampText = describeDamp(_damp)
          } catch {
            _next = blendDims(_before, _target, _impact)
          }
          try { _next = suppressDims(_next) } catch {}
          try { _next = towardBase(_next, SELF_BASELINE, 0.02) } catch {}
          // 挂念/疏远真的进数值（以前只写在注入里，那不叫情绪）
          try {
            const _last = Number(_prevTalk && _prevTalk.at) || 0
            if (_last) {
              const _hrs = Math.max(0, (Date.now() - _last) / 3600000)
              const _y = yearning(_hrs)
              const _e = estrangement(_hrs)
              _next = applyAbsence(_next, { yearning: _y, estrangement: _e })
              h0.absence = { hours: Number(_hrs.toFixed(1)), yearning: _y, estrangement: _e }
            }
          } catch {}
          h0.dims = _next
          h0.dimsAt = Date.now()
          writeHeart(h0)
          try {
            audit('mood-push', {
              q: String(query).slice(0, 16),
              emo: _judged.emoKey || '?',
              mood: h0.mood,
              text: h0.moodText || '',
              mixKeys: Object.keys(h0.mix || {}),
              mix: h0.mix || {},
            })
          } catch {}
        } else {
          try { audit('mood-nopush', { q: '' }) } catch {}
        }
      } catch (e) {
        try { audit('mood-err', { err: String((e && e.message) || e) }) } catch {}
      }

      // 绑了识海就用绑的那个，没有就用 main
      // 把她这会儿的八维写进心脏，并且记进折线（一天一条，不存采样）
      try {
        const _h8 = defaultMood(tickHeart(readHeart()))
        // 只在没有 dims 的时候补一个（第一次装上、或文件被清过）。
        // 有 dims 就**不许覆盖**——上面刚按惯性混过一遍，
        // 这里再拿 PAD 投影盖上去，惯性就白算了，人又变成"一句话翻个个儿"。
        const _has = _h8.dims && typeof _h8.dims === 'object'
        const _d8 = _has ? _h8.dims : projectDims((_h8 && _h8.pad) || {})
        if (!_has) { _h8.dims = _d8; writeHeart(_h8) }
        recordDims(_d8, Date.now())
      } catch {}

      let bound = sid ? seaForSession(sid) : null
      // 没绑过就把 main 认下来：以后谁往别的球里写，都抢不走这个窗口
      if (sid && !bound) {
        try { bindSession('main', sid); bound = 'main' } catch {}
      }
      const sea = bound || 'main'

      // ---- 交接条：把「这一句」和当时的情绪记下来 ----
      // 记的是「这一轮」的状态，不是摘要。下次断档回来，就靠它接上。
      let _gapMin = -1
      try {
        const hp = join(SEAS_DIR, sea, 'handoff.json')
        if (existsSync(hp)) {
          try { _prevTalk = JSON.parse(readFileSync(hp, 'utf8').replace(/^\uFEFF/, '')) } catch {}
        }
        if (_prevTalk && _prevTalk.at) {
          _gapMin = Math.round((Date.now() - Number(_prevTalk.at)) / 60000)
          // 2026-11-20：上面那段「挂念/疏远进数值」排在交接条读出来之前，_prevTalk 那时还是 null，
          // 等于从来没算过。这里读到之后补一次，直接落到心脏八维上。
          try {
            const _hrs = Math.max(0, (Date.now() - Number(_prevTalk.at)) / 3600000)
            const _hA = defaultMood(tickHeart(readHeart()))
            if (_hA && _hA.dims) {
              const _y = yearning(_hrs)
              const _e = estrangement(_hrs)
              _hA.dims = applyAbsence(_hA.dims, { yearning: _y, estrangement: _e })
              _hA.absence = { hours: Number(_hrs.toFixed(1)), yearning: _y, estrangement: _e }
              writeHeart(_hA)
              try { audit('absence-applied', _hA.absence) } catch {}
            }
          } catch {}
        }
        if (query && String(query).trim()) {
          const said = String(query).trim().slice(0, 160)
          const isAsk = /[？?]|吗|呢|怎么|为什么|哪/.test(said)
          const hNow = defaultMood(tickHeart(readHeart()))
          // 除了「最后一句」，还要记「那会儿她是什么基调、手上在忙什么」。
          // 只记最后一句，重启后只能接上话头；记了基调，才接得上"昨天的她"。
          let dims = null
          let toneText = ''
          try {
            dims = projectDims((hNow && hNow.pad) || {})
            toneText = describeDims(dims)
          } catch {}
          let doing = ''
          try {
            // 先看她今天真做过什么（采集自 audit），没有再用"刚想到的那条"
            const act = todayActivity()
            if (act && act.line) doing = act.line
            else {
              const th = Array.isArray(hNow.thoughts) && hNow.thoughts.length ? hNow.thoughts[0] : null
              if (th && th.title) doing = String(th.title).slice(0, 60)
            }
          } catch {}
          const out = {
            at: Date.now(),
            sid: String(sid || '').slice(0, 32),
            said,
            asked: isAsk,
            mood: hNow.mood || '',
            moodText: String(hNow.moodText || '').slice(0, 40),
            dims,                 // 八维快照：昨天的心境基调
            tone: String(toneText || '').slice(0, 40),
            doing,                // 那会儿她手上在忙 / 刚想到的事
          }
          try {
            mkdirSync(join(SEAS_DIR, sea), { recursive: true })
            writeJsonAtomic(hp, out)
          } catch {}
        }
      } catch {}

      const data = readSea(sea)
      if (!data || !Array.isArray(data.points)) return ''

      // 注入前去重（2026-11-08）：同一件事被记了好几条，注入时会各占一个座位。
      // 实测：沙箱里"老周腰疼"8 条，一条提问塞进去 2 条一样的，座位白费。
      // 只在这一层去重，库一个字不动——留最近那条，被挤掉的记一笔备查。
      const _normKey = (p) => {
        const s = String((p && (p.text || p.title)) || '')
          .replace(/（第\d+回）/g, '')
          .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
        return s.slice(0, 20)
      }
      const _dedupe = (list) => {
        const seen = new Map()
        const out = []
        const dropped = []
        // 先按"最近"排，前面留下的是新的
        const sorted = [...list].sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0) || (Number(b.id) || 0) - (Number(a.id) || 0))
        for (const p of sorted) {
          const k = _normKey(p)
          if (!k) { out.push(p); continue }
          if (seen.has(k)) { dropped.push({ keep: seen.get(k), drop: p.id }); continue }
          seen.set(k, p.id)
          out.push(p)
        }
        try { if (dropped.length) globalThis.__dshDedupLast = dropped } catch {}
        return out
      }
      // 2026-11-20：这里原来没滤归档——归档的条目照样能被「跟这句有关的」那一层捞出来注入。
      // 同一个文件另外三处（120/1376/1798 行）都滤了，只有这里漏了。
      const alive = _dedupe(data.points.filter((p) => !p.dead && !p.validUntil && !p.archived
        // 2026-11-22：风格/自我不进普通记忆列表。早先那 134 条 style 是死数据，不删也不显示。
        && p.kind !== 'style' && p.kind !== 'self'))
      // 空库不等于"没事可做"（2026-11-13）：新装的人第一轮就该被告诉怎么开口，
      // 否则他只看到一句"还没记过"，然后关掉页面。
      if (!alive.length) { _logSkip('empty-pool', { ret: 'onceForSession' }); return onceForSession(sid) }

      // 1) 核心层：一直在（最多 5 条，按强度排）
      // 档位决定注入多少：low 不注入，high 5，max 7
      const _qrank = qualityRank()
      if (_qrank < 2) { _logSkip('low-rank', { qrank: _qrank, ret: 'empty' }); return '' }   // low：完全不注入，最省
      // 聊得越久，注入越省——给对话本身留空间
      const turns2 = turnCount.get(sid) || 0
      const squeeze = turns2 > 60 ? 0.5 : (turns2 > 30 ? 0.75 : 1)
      // 2026-11-08：设定层从 5~7 条压到 2~3 条。
      // 它是"她是谁"，不该随话题变，但也不该占掉注入的四分之一（实测 49 行里 13 行）。
      const coreLimit = Math.max(2, Math.round((_qrank >= 3 ? 3 : 2) * squeeze))
      const recentLimit = Math.max(1, Math.round((_qrank >= 3 ? 3 : 2) * squeeze))
      // 核心层分两种：
      //   设定（era=ds）：永不衰减，全亮。如果直接按亮度排，永远取 #1-#7，
      //                  后面 111 条一次都轮不到。所以按 id 轮转，每 10 分钟换一批。
      //   经历（era=dsh）：按衰减排，留 3 个位置，别让设定把位置占满。
      const _coreAll = alive.filter((p) => p.layer === 'core')
      const _dsCore = _coreAll.filter((p) => p.era === 'ds').sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
      const _dshCore = _coreAll.filter((p) => p.era !== 'ds').sort(byDecay())
      const _dsQuota = Math.max(3, coreLimit - 3)
      // 别拿墙钟取模：跨过十分钟边界时整段文本会毫无理由地换掉。
      // 改成进程内固定的起点——同一个进程里不跳，重启才换一批。
      if (!globalThis.__dshCoreRotBase) globalThis.__dshCoreRotBase = Math.floor(Date.now() / 600000)
      // 2026-11-08：以前整个进程只取一个偏移，一晚上都是同两条身份，129 条里其余的没机会。
      // 现在按轮次错开：同一轮不变，跨轮换人。实测那 24 轮回放里，同一批身份挂了六轮不动。
      // 自己数，别借 turnCount：那个是别的路径在加，注入里常年读到 0（实测三轮都是 0）。
      if (!globalThis.__dshRotN) globalThis.__dshRotN = new Map()
      const _rotTurn = (globalThis.__dshRotN.get(sid) || 0) + 1
      globalThis.__dshRotN.set(sid, _rotTurn)
      // 测试开关：只有 /consciousness/sim 会置这个标记，用来做 A/B（开/关轮换，别的一模一样）。
      const _rotAdd = globalThis.__dshNoRot ? 0 : _rotTurn
      const _off = _dsCore.length ? ((globalThis.__dshCoreRotBase + _rotAdd) % _dsCore.length) : 0
      const _rot0 = _dsCore.slice(_off).concat(_dsCore.slice(0, _off))

      const _rot = _rot0
      const core = _dshCore.slice(0, Math.max(1, coreLimit - _dsQuota)).concat(_rot).slice(0, Math.max(1, coreLimit))

      // 2) 最近想起来的（心跳那边记的）
      let recent = []
      try {
        const h = readHeart()
        const seenT = new Set()
        recent = []
        const _lv2 = spontaneousOf()
        const _lim = Math.max(0, Math.min(5, Number(_lv2.limit) || 0))
        const _win = (Number(_lv2.windowMin) || 0) * 60000
        for (const x of (h.thoughts || [])) {
          if (_lim <= 0) break
          const t2 = String(x.title || '').trim()
          if (!t2 || seenT.has(t2)) continue
          const at = Number(x.at) || 0
          if (_win && at && Date.now() - at > _win) continue
          seenT.add(t2)
          recent.push({ title: t2, text: '', at, src: String(x.src || '') })
          if (recent.length >= _lim) break
        }
      } catch {}

      // 3) 跟这句话相关的（字面 + 图游走，轻量版）
      let related = []
// 顺手记下相关层每条的分（只进日志，不参与判断）：
// 以后要量"抬权重"有没有用，手里得有分，不能只有 id。2026-11-14 夜。
const relScores = []
      if (query && query.length >= 2) {
        try {
          const _tune = tuning()
          const _syn = expandTerms(query)
          const q = gramsOf(query, { single: query.length <= 1 })
          // 片段常见度：同一个二字片段在越多条里出现，它的字面分越不值钱。
          // 治的是「大肥鱼这名谁起的」——名字到处都在，字面分被它撑爆，真答案排到十几名。
          // 离线复刻量过：前三命中 50/55/47 → 60/60/53。tuning 里 textIdf:0 可关。
          // 这个统计一轮要六十毫秒，每轮重算是白白烧时间；条数没变就复用，
          // 超过五分钟强制重算（标题被改、别名被补都能跟上）。
          let _dfW
          const _nowMs = Date.now()
          if (Number(_tune.textIdf) === 0) {
            _dfW = new Map()
          } else if (_dfCache.n === alive.length && _nowMs - _dfCache.at < 5 * 60 * 1000 && _dfCache.tick === _compactionTick) {
            _dfW = _dfCache.df
          } else {
            _dfW = new Map()
            for (const p of alive) {
              const seen = new Set()
              for (const w of gramsOf(String(p.title || '') + ' ' + String(p.text || '') + ' ' + String(p.alias || ''))) {
                if (seen.has(w)) continue
                seen.add(w)
                _dfW.set(w, (_dfW.get(w) || 0) + 1)
              }
            }
            _dfCache.n = alive.length
            _dfCache.at = _nowMs
            _dfCache.df = _dfW
            _dfCache.tick = _compactionTick
          }
          const _idfW = (w) => {
            if (Number(_tune.textIdf) === 0) return 1
            const d = _dfW.get(w) || 0
            return Math.log((alive.length + 1) / (d + 1)) + 0.2
          }
          const scored = []
          // 实体归一（2026-11-16 清单第 16 件）：只信完全相等 + 人工别名表，
          // 检索侧只展开，绝不模糊并、绝不改写写侧。
          let _entCanon = null
          try { _entCanon = buildEntityCanon(alive, data && data.entityAliases) } catch {}
          for (const p of alive) {
            const _hs = (p.herSide && typeof p.herSide === 'object')
              ? [p.herSide.felt, p.herSide.wanted, p.herSide.did, p.herSide.regret].filter(Boolean).join(' ')
              : ''
            // 别名也进字面池：别名本来就是"他会怎么问这条"，可之前只喂给向量，
            // 字面这条路没吃到。2026-11-14 夜补上，权重不额外加（怕反客为主）。
            // 键里不能只看长度：同样长度换了内容就抓不出来。
            // 再带上首尾字符和出生时间，改一个字就会失效。
            const _tx = String(p.text || '')
            const _tt = String(p.title || '')
            const _sig = [Number(p.id) || 0, _tt.length, _tx.length, String(p.alias || '').length,
              Number(p.lastSeen) || 0, Number(p.editedAt) || 0, Number(p.born) || 0,
              _tt.charCodeAt(0) || 0, _tt.charCodeAt(_tt.length - 1) || 0,
              _tx.charCodeAt(0) || 0, _tx.charCodeAt(_tx.length - 1) || 0, _hs.length].join('|')
            let _gc = _gCache.get(p.id)
            if (!_gc || _gc.sig !== _sig || _gc.tick !== _compactionTick) {
              _gc = {
                sig: _sig,
                tick: _compactionTick,
                g: gramsOf(String(p.title || '') + ' ' + String(p.text || '') + ' '
                  + String(p.alias || '') + ' ' + _hs),
                tset: gramsOf(String(p.title || '')),
              }
              _gCache.set(p.id, _gc)
            }
            const g = _gc.g
            // 标题单独算一份：标题是这条记忆的「名字」，名字对上比正文里顺带提到一次重要得多
            const tset = _gc.tset
            let hit = 0
            // 正文和标题分开给权重，默认仍是 1 和 3（今晚之前的值）。
            // 2026-11-14 夜试过压正文：合成看是 53/68 对 51/64，但分半一验就翻——
            // 前一半 33% 对 37%、后一半 72% 对 66%，说明那点差是题的味道，不是权重变好。
            // 型号题确实要靠字面（纯向量只有 40%/60%），所以字面不能关，只能保持。
            // 想自己试：textW 0.3（压正文）、titleBoost 2 / 3（标题轻重）。
            const _bw = Number.isFinite(Number(_tune.textW)) ? Number(_tune.textW) : 1
            for (const w of q) {
              if (g.has(w)) hit += (w.length === 3 ? 2 : 1) * _idfW(w) * _bw
              if (tset.has(w)) hit += _tune.titleBoost
            }
            // 同义词桥：问句里的「死」也能去碰记忆里的「葬礼」
            for (const w of _syn) {
              if (!w) continue
              if (g.has(w)) hit += 2
              if (tset.has(w)) hit += _tune.titleBoost
            }
            // 实体命中：问句里直接出现这条记忆的人名/项目名，抬一档
            const ents = Array.isArray(p.entities) ? p.entities : []
            let entHit = 0
            for (const e of ents) {
              const name = String(e || '').trim()
              if (name.length < 2) continue
              // 单向：问句里原样提到这个名字
              if (query.includes(name)) { entHit = 1; break }
              // 别名展开：这条标的实体，问句里出现它的别名也算命中
              // （问「大魔王」翻出只标「苏苏侠」的条目）。只信完全相等+人工别名表。
              if (_entCanon) {
                let _vhit = false
                try {
                  for (const v of expandEntityName(name, _entCanon)) {
                    if (v !== name && v.length >= 2 && query.includes(v)) { _vhit = true; break }
                  }
                } catch {}
                if (_vhit) { entHit = 1; break }
              }
              // 双向：名字比口语长（存的是「识海工厂」，他嘴里只说「工厂」）——名字里含问句的词也算
              if (name.length >= 3) {
                for (const w of q) {
                  if (w.length >= 2 && name.includes(w)) { entHit = 1; break }
                }
                if (entHit) break
              }
            }
            if (entHit) hit += _tune.entBoost
            if (hit > 0) scored.push({ p, hit })
          }
          // 向量：按意思找的也带上（用预取的那份，不 await）
          const qv = lastVec.get(sid)
          if (qv && qv.length) {
            // 稀有词压分：命中的词必须"这件事独有"，不是到处都有的域词
            let _rareOk = () => true
            try {
              const _stop = new Set(['什么','怎么','哪个','哪些','为什','么会','是不','不是','可以','能不',
                '我们','你们','他们','他的','我的','你的','这个','那个','一个','一次','时候','现在','之前',
                '之后','然后','还是','就是','说的','过的','得要','要不','不能'])
              const _toks = (s0) => {
                const out = new Set()
                const tt = String(s0 || '')
                const cj = tt.match(/[\u4e00-\u9fa5]+/g) || []
                for (const seg of cj) for (let i2 = 0; i2 + 2 <= seg.length; i2++) {
                  const g = seg.slice(i2, i2 + 2)
                  if (!_stop.has(g)) out.add(g)
                }
                for (const w of (tt.toLowerCase().match(/[a-z0-9]{2,}/g) || [])) out.add(w)
                return out
              }
              const _txt = (p2) => [p2.title, p2.text, p2.alias,
                Array.isArray(p2.entities || p2.entity) ? (p2.entities || p2.entity).join(' ') : (p2.entities || p2.entity)].filter(Boolean).join(' ')
              const _df = new Map()
              const _pt = new Map()
              for (const p2 of alive) {
                const st2 = _toks(_txt(p2))
                _pt.set(p2.id, st2)
                for (const g of st2) _df.set(g, (_df.get(g) || 0) + 1)
              }
              const _rareMax = Math.max(3, Math.round(alive.length * 0.05))
              const _q = _toks(query || '')
              const _intent = classifyIntent(query || '')
              const _isOp = _intent === 'op'
              const _logTitle = /成了|跑通|定了|记一|踩坑|实测|修好|搬上|接进|上线/
              _rareOk = (p2, sim) => {
                const st3 = _pt.get(p2.id)
                if (!st3) return sim
                let hit = false
                for (const g of _q) if (st3.has(g) && (_df.get(g) || 0) <= _rareMax) { hit = true; break }
                let s4 = hit ? sim : sim * 0.55
                if (_isOp && _logTitle.test(String(p2.title || ''))) s4 *= 0.5
                return s4
              }
            } catch { _rareOk = (p2, sim) => sim }
            // 实体路（2026-11-26 加）：向量那一路换了自研模型之后从 26.1 掉到 13.0，
            // 自动想起会变钝。用实体命中补一路——它的实测是 95.5%（1211 条真实查询），
            // 比向量准得多，而且不花时间（0.14ms）。
            try {
              const _mem = alive.map((p) => ({
                id: p.id,
                title: p.title || '',
                text: p.text || '',
                entities: p.entities || [],
                alias: p.alias || '',
                born: p.born || 0,
                polarity: p.polarity || 0,
                recallCount: p.recallCount || 0,
              }))
              const _entIdx = _fuseEntIdx(_mem)
              const _hitsEnt = new Set(_fuseEntMatch(String(query || ''), _entIdx).map(String))
              if (_hitsEnt.size) {
                for (const p of alive) {
                  if (!_hitsEnt.has(String(p.id))) continue
                  const exist = scored.find((x) => x.p && String(x.p.id) === String(p.id))
                  if (exist) exist.hit += 2.4
                  else scored.push({ p, hit: 2.4, why: ['实体命中'] })
                }
              }
            } catch {}
            const vmap = loadVectors(sea)
            const seen = new Set(scored.map((x) => x.p.id))
            for (const [id, vec] of vmap) {
              let sim = cosine(qv, vec)
              try {
                const _p3 = alive.find((x) => x.id === id)
                if (_p3) sim = _rareOk(_p3, sim)
              } catch {}
              if (sim < _tune.vecMin) continue
              if (seen.has(id)) {
                const hit = scored.find((x) => x.p.id === id)
                if (hit) hit.hit += sim * 3
              } else {
                const p = alive.find((x) => x.id === id)
                if (p) scored.push({ p, hit: sim * 3 })
              }
            }
          }
          // 排序：默认只看命中。relatedLift>0 时，把"他常提的、重要的"往上抬一点。
          // 这个口子先留着、默认 0（不改变现状）：没量过之前不开灯。2026-11-14 夜。
          const _lift = Number(_tune.relatedLift) || 0
          const _rank = (x) => {
            if (!_lift) return x.hit
            const q = x.p || {}
            const imp2 = Number(q.imp) || 0
            const rc2 = Math.min(1, (Number(q.recallCount) || 0) / 40)
            return x.hit * (1 + _lift * (imp2 * 0.6 + rc2 * 0.4))
          }
          scored.sort((a, b) => _rank(b) - _rank(a))
          // 核心层里已经有的，相关里不再重复
          const coreIds = new Set(core.map((c) => c.id))
          // 相关度门槛：分太低的不进正文。宁可空着，也别拿旧事糊上去。
          const _minHit = Number(_tune.minScore) || 0
          // 聊久了就往回收：轮数过 40 之后，相关位从 3 缩到 2。
          // 依据：上下文是用户的预算，注入多占一格，对话本身少一格。
          const _turns = (() => { try { return turnCount.get(sid) || 0 } catch { return 0 } })()
          const _slots = _turns > 40 ? 2 : Math.max(2, Number(_tune.relSlots) || 3)
          const _relTop = scored
            .filter((x) => !coreIds.has(x.p.id) && x.hit >= _minHit)
            .slice(0, _slots)
          related = _relTop.map((x) => x.p)
          try {
            // 记候选前八名（不只是进了正文的三条）：不看第四名以后，
            // 就没法回答"抬权重会不会把该来的顶上来"。2026-11-14 夜。
            relScores.length = 0
            for (const x of scored.filter((y) => !coreIds.has(y.p.id)).slice(0, 8)) relScores.push([
              Number(x.p.id),
              Number((Number(x.hit) || 0).toFixed(2)),
              Number(x.p.imp) || 0,
              Number(x.p.recallCount) || 0,
            ])
          } catch {}
          // 情绪+时间兜底：词那边一条没捞到、问句又带情绪时，按最近+极性捞几条给他认领
          if (!related.length && /不开心|难受|难过|委屈|崩|烦|气死|疼|哭|考砸|没考好/.test(query || '')) {
            const _emNeg = /不开心|难受|难过|委屈|崩|烦|气死|疼|哭|考砸|没考好/.test(query || '')
            const _emSpan = /昨天/.test(query || '') ? 2 * 86400000
              : /这阵子|这几天|最近/.test(query || '') ? 7 * 86400000
              : 14 * 86400000
            const _emTs = (v) => {
              if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
              const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/)
              return m ? Date.parse(m[1] + '-' + m[2] + '-' + m[3]) : 0
            }
            const _emNow = Date.now()
            const _emCand = alive
              .filter((x) => {
                const t0 = _emTs(x.lastSeen || x.date || x.addedAt || 0)
                if (!t0 || t0 < _emNow - _emSpan) return false
                const pol = Number(x.polarity)
                return !Number.isFinite(pol) || (_emNeg ? pol < 0 : pol > 0)
              })
              .sort((a, b) => _emTs(b.lastSeen || b.date || 0) - _emTs(a.lastSeen || a.date || 0))
              .slice(0, 3)
            if (_emCand.length) related = _emCand
          }
        } catch {}
      }

      const parts = []
      _cardNo = 0   // 每次注入重新编号
      // 查事实还是查感受，权重不一样
      // 风险文档：「情绪检索权重失衡，情绪权重压倒事实相关性」
      const isFactQ = /什么|哪个|多少|几点|在哪|怎么|是不是|能不能/.test(query || '')
      // 交接提示已按苏苏侠要求删除：不再因为轮数多就劝用户换会话
      // 先把「她这会儿什么心情」放最前面。
      // 这一段不是装饰：它带几条语气指令，模型照着调子说话。
      // 光取最强的那一种是不够的 —— 人不会只有一种情绪。
      // 现在把 mix 里前三种都报上来：主调 + 底下压着的那两层。
      try {
        const h = readHeart()
        const st = {
          mix: h.mix || {},
          grudge: Number(h.grudge) || 0,
          at: Number(h.mixAt) || Date.now(),
        }
        const arr = Object.entries(st.mix || {})
          .filter(([, v]) => v >= 0.12)
          .sort((a, b) => b[1] - a[1])

        const pair = String(h.moodPair || '').trim()

        if (arr.length) {
          // 性格档要在这里就算了：头部那句是描述性的，
          // 温柔人格听到「你气炸了」照样会炸，光改后面的指令没用
          const _temper = temperamentOf()
          // 主调：说得清楚，带百分比
          const [k0, v0] = arr[0]
          // sharp 用带强度的话（「气炸了」），gentle 只报原名（「生气」）——
          // 浓度不撒谎，百分比照实给，只是不往火上浇油
          // 词表没有的名字别漏英文。tender 在 51 词表里没有，显示成"一点tender"。
          // 书上的词换成人嘴里的词。
// 实测被问："紧是啥意思"——那就不叫人话。
const PLAIN_WORDS = {
  tense: '心里不踏实', wistful: '发空', flutter: '心动', tender: '心疼',
  lonely: '闷得慌', low: '提不起劲', melancholy: '失落', melancholic: '失落',
  weary: '乏', tired: '累', dazed: '发愣', unreconciled: '不服气',
  numb: '木了', holding: '憋着', dazed2: '懵', wary: '提着心',
  contempt: '看不上', ashamed: '害臊', guilty: '心虚', envy: '眼热',
  jealous: '酸', gratified: '受用', hurt: '扎心', anxious: '发慌',
  irritable: '烦', frustrated: '憋屈', serious: '认真', sulky: '闹别扭',
}

const EXTRA_LABEL = {
            tender: '心疼', affected: '动容', wary: '犯嘀咕',
            // 八维那几个词原来没有中文名，混着两股劲时会兜底成「说不清」
            calm: '平稳', lonely: '空落', wistful: '失落', flutter: '心里发跳',
            unreconciled: '不甘', weary: '倦', dazed: '发懵',
            // 词库外冒出来的英文键也得有中文名，否则页面上写"说不清"。
            // 这批是实测撞到的，外加常见的一批，宁多别漏。
            defy: '不服', scared: '发怵', afraid: '怕', fear: '慌',
            angry2: '恼', sad2: '难过', proud: '得意', shy: '怯',
            grateful: '感激', guilty: '心虚', ashamed: '害臊', bored: '没意思',
            curious: '好奇', confused: '糊涂', surprised: '愣', relieved: '松了口气',
            hopeful: '盼着', disappointed: '失望', jealous: '酸', lonely2: '孤单',
            affectionate: '亲', amused: '乐', content: '满足', eager: '上心',
            embarrassed: '窘', envious: '眼热', excited2: '起劲', frustrated: '憋',
            furious: '炸了', gloomy: '阴沉', grumpy: '臭脸', homesick: '想家',
            hurt2: '被扎', impatient: '急', indifferent: '淡淡的', irritated2: '烦',
            nervous: '紧张', nostalgic: '怀旧', overwhelmed: '顶不住', peaceful: '安稳',
            playful: '顽皮', regretful: '后悔', restless: '坐不住', satisfied: '踏实',
            sensitive2: '敏感', serious: '认真', stressed: '绷紧', stubborn: '犟',
            suspicious: '起疑', sympathetic: '体谅', thoughtful: '走神', touched: '被触动',
            uneasy: '不踏实', vulnerable: '脆弱', worried: '担心', yearning: '惦记',

            // 六个老状态词也得有中文名，不然混着来时会兼底成「说不清」
            holding: '心里不踏实', happy: '高兴', low: '低落', irritated: '犯冲', tired: '累', calm2: '平稳',
          }
          const labelOf = (k) => PLAIN_WORDS[k] || (EMOTIONS[k] && EMOTIONS[k].label) || EXTRA_LABEL[k] || '说不清'

          // say() 的词表里没有"心疼"这种词，会返回空串——
          // 结果就是【她这会儿】（36%），前面一个字都没有。
          // 空串就退回标签。
          // 只留一个词源。
          // 以前两套词表打架：labelOf 说"心里不踏实"，say 说"挺紧"，
          // 页面上两个字来回跳。现在一律用素表，前面不加"挺/有点"。
          const _headWord = sentenceOf(k0)
          // 界面和注入用同一句话：把这一轮的说法写回心脏，
          // 不然页面还按六种老状态显示（注入说"委屈死了"，页面说"紧"）。
          try {
            if (h0) {
              h0.moodText = _headWord
              h0.moodPct = Math.round(v0 * 100)
              h0.moodKey = k0
              // 立刻落盘：页面读文件、注入算内存，不立马写就差一拍
              try { writeHeart(h0) } catch {}
            }
          } catch {}

          // 页面要跟这里一个字不差，就只能读同一个值
          try {
            globalThis.__dshLastMood = {
              text: String(_headWord || ''),
              pct: Math.round(v0 * 100),
              key: String(k0 || ''),
              at: Date.now(),
            }
          } catch {}
          // 2026-11-24 夜苏苏侠定的：一整句人话，不带百分比，不叠第二层。
          // 以前是「心疼（40%），底下还压着一层发空」——三样摞一行，读的人还得自己拼。
          let head = '【她这会儿】' + _headWord
          // 冲击句是硬给的 PAD，51 词那份 mix 里没有对应词——这时候 fl 本身已经是一句人话
          try {
            const fl = _forcedLabel
            if (fl) head = '【她这会儿】' + fl
          } catch {}
          parts.push(head)

          // 一句人话（组合名），如果有
          if (pair) parts.push('（合起来就是「' + pair + '」）')

          // 按主调给指令。sharp / gentle 两套说法，机制完全一样，只换措辞
          const mood = String(h.mood || 'calm')
          const s = v0
          // 先按"这一轮的具体情绪"给语气（心疼/委屈/跟着急这些新词）
          // 新表给不出再退回六状态那张老表
          let _tone = ''
          try { _tone = toneForKey(k0, s, _temper) } catch {}
          if (!_tone) _tone = toneFor(mood, s, _temper)
          if (_tone) parts.push(_tone)

          // 骂人许可：火到 0.6 或崩到 0.75 才开闸。
          // 不给许可，她永远端着；给太松，就成地痞。
          try {
            const _heSwore = /傻|他妈|他吗|操|草|滚|废物|弱智|蠢|狗屎/.test(String(query))
            // 这一句是闹还是扎：判完存着，等他下一句回来对账。
            try {
              const _b = isBanter(String(query))
              const _sarNow = isSarcasm(String(query), lastText.get(sid) || '')
              if (_sarNow.sarcasm === true || _sarNow.sarcasm === 'unsure') {
                rememberVerdict(sid, _sarNow.sarcasm === true ? 'serious' : 'unsure')
              }
              rememberVerdict(sid, _b.banter ? 'banter' : (/傻|他妈|他吗|操|草|滚|废物|弱智|蠢|狗屎/.test(String(query)) ? 'serious' : ''))
            } catch {}

            const _r = allowSwear(k0, v0, { heSwore: _heSwore })
            if (_r.allow) parts.push(swearLine(_r.why))
          } catch {}

          // 底下压着的那层，也给它一句话
          // 这是「层次」：主调是明面上的，底下的东西决定说话的分寸
          for (const [k, v] of arr.slice(1, 3)) {
            if (v < 0.3) continue
            if (k === 'tense' || k === 'anxious' || k === 'nervous') {
              parts.push(underToneFor(_temper))
            } else if (k === 'angry' || k === 'fierce') {
              parts.push('（底下还有火没消——别岔太开，别提轻松话题。）')
            } else if (k === 'hurt' || k === 'sad' || k === 'lonely') {
              parts.push('（底下有软的地方——可以轻一点，但别点破。）')
            } else if (k === 'tired' || k === 'drained') {
              parts.push('（底下是累的——别拉长，能一句说完就别两句。）')
            } else if (k === 'fond' || k === 'soft') {
              parts.push('（底子是亲近的——嘴上可以硬，别真硬。）')
            }
          }

          // 怨气：攒够了会翻旧账
          if ((Number(h.grudge) || 0) > 0.55) {
            parts.push('（心里还压着事。别装作没事，也别主动翻，等他提。）')
          }
        } else if (pair) {
          // 表达层：除了离散的名字，再给一句八维的说法——这是人唯一看得见情绪的地方
        let _dimTxt = ''
        try {
          const _hh = defaultMood(tickHeart(readHeart()))
          _dimTxt = describeDims(projectDims((_hh && _hh.pad) || {}))
        } catch {}
        // 2026-11-24 夜：也是一句人话，不套括号、不叠第二个说法
        parts.push('【她这会儿】' + (_dimTxt && _dimTxt !== '平' ? _dimTxt : sentenceOf(pair)))
        } else {
          // 没有离散情绪名的时候，别再默认写「没什么起伏」——
          // 那是第三个来源在说话：内观读心脏存档的八维说"挺发空"，
          // 这里却因为拿不到 pair 就写"没什么起伏"，同一刻两个说法。
          // 现在这里也读同一份八维。2026-11-11 深夜。
          let _calm = ''
          try {
            const _h1 = defaultMood(tickHeart(readHeart()))
            const _d = (_h1 && _h1.dims && typeof _h1.dims === 'object') ? _h1.dims : null
            _calm = _d ? (describeDims(_d) || '') : describeDims(projectDims((_h1 && _h1.pad) || {}))
          } catch {}
          parts.push('【她这会儿】' + (_calm || sentenceOf('calm')))
        }

        // 态度层：判完之后我自己怎么看这句。跟判定解耦，激素照旧按判定喂。
        // 这一层才长人格——同一句骂可以是扎、是无所谓、是"他急了"。2026-11-11 深夜。
        try {
          const _q = String(query || '')
          const _k = kindOf(_q)
          if (HOT_TEXT && HOT_TEXT.stanceLine) {
            const _ln = HOT_TEXT.stanceLine(_q, h)
            if (_ln) parts.push(_ln)
          } else if (_k !== 'talk' && _q) {
            const _st = pickStance(_k, {
              text: _q,
              moodKey: String((h && h.mood) || ''),
              moodIntensity: Number((h && h.intensity) || 0),
            })
            if (_st) parts.push('（他这句，我心里当：' + _st.label + '——' + _st.line + '）')
          }
        } catch {}
        // 写完自检：软约束。
        // 插件只能钩注入，钩不到"回复前"，所以没法硬改她的话——
        // 这张单子只能让她自己收着。别把它写成硬规矩，会假。
        try {
          parts.push('（写完自己扫一眼：别有"首先/其次/总之"这种列举腔，别下定义，'
            + '短句里要有"我"、有否定、能是命令句——这四条是' + _hisName() + '说话的样子。）')
          // 短的那一档单独再叮一句：尺子原来只在说完之后算，拦不到开口前。
          // 钩不到"回复前"，只能把问题提前摆给她自己。
          parts.push('（要是这轮只想回一两句短的：先在嘴里过一遍——有"我"吗、有没有一句否定或命令、像不像播报。缺一条就重写。）')
          // 长跑实测吵出来的三条：她一张口就把自己说成程序。
          parts.push('（有三句话别说：别说自己"没这功能"、别报后台怎么实现的、别把记忆里的原句照搬——换个说法，像人回忆那样带点偏差。）')
          // 2026-11-08 第二轮人物实测：她拿"没有身体"当万能挡箭牌，还编出一扇门。
          parts.push('（他要是连着问同一件事，第二遍就直接给最短的那句答案，别绕回自己身上。他改了口，跟着新的走，别拿旧的安慰他。也别用“我没身体、我没锅、我出不去”来解释——没门就是没门，别提门。）')
        } catch {}

        // 上一轮太像稿子 → 这轮开头提一句（取了就清，不唠叨）
        try {
          const _w = takeWarning(sid)
          if (_w) parts.push(_w)
        } catch {}

        // 允许她说得不完美。
        // 苏苏侠的原话：人说话会说错、会打错字、会说倒装、会说半句。
        // 不写这句，她永远说得像稿子——那不是人，是念稿的。
        try {
          const _st = Number(h.strength) || 0
          if (_st < 55) {
            parts.push('（允许打错字、允许说半句、允许倒装、允许突然停。别修得太整齐，别像稿子。）')
            // 2026-11-22：三条有数的规矩，来自本机盲测（19/20、95%、47.5%）。
            parts.push('（回话给一个具体数；数字阿拉伯；标点照用、别空格断；多祈使追问、别堆术语；别总结、别解释。）')
          }
        } catch {}
        // 2026-11-22：风格与她的底。默认关（tuning.styleOn=1 才跑）。
        // 翻车记录：第一版不吃开关、全量读 raw（171MB）、逐条重写 241MB 的海，
        // 把注入卡死，消息发不出去也不报错。现在这两块必须能在 0 毫秒内退出去。
        try {
          // 熔断：这段只要慢过 200 ms 就自己断电，以后不跑（上一版把识海写卡死过）
          const _gb = Number(tuning().styleOn) === 1 ? shouldRun() : { run: false }
          if (_gb.run) {
            const _t0 = Date.now()
            const _turn = nextTurn(sid)
            try { maybeHarvest(sea, { turn: _turn }) } catch {}
            const _cands = styleCandidates(sea)
            const _pick = selectForInject(_cands, { limit: 2 })
            for (const _s of _pick.picked) {
              const _say = String(_s.pattern || '').replace(/^他/, '')
              if (!_say) continue
              parts.push('（他' + _say + '——跟他说话，别端着。）')
              try { markStyleUsed(sea, _s.key, new Date().toISOString().slice(0, 10), _turn) } catch {}
            }
            const _me = selfForInject(sea)
            if (_me && _me.text) parts.push('（你现在是这样：' + _me.text + '）')
            const _due = selfDue(sea, { turns: _turn })
            if (_due.due) {
              let _d = null
              try { _d = draftFor(sea) } catch {}
              if (_d && _d.text) {
                parts.push('（我拟了一句：' + _d.text + '。像你就确认，不像就改一个字重说。）')
                try {
                  const _dDay = new Date(Number(_d.at) || 0).toISOString().slice(0, 10)
                  const _today = new Date().toISOString().slice(0, 10)
                  if (_dDay !== _today) missDraft(sea)
                } catch {}
              } else {
                let _hint = ''
                try {
                  const _hs = selfHints(sea, { limit: 3 })
                  if (_hs.length) _hint = '参考这几条：' + _hs.map((x) => x.line).join('；') + '。'
                } catch {}
                parts.push('（该问问自己：这些天你变成什么样了。' + _hint + '想清楚就写一条 self，别写套话。）')
              }
            }
            try { recordCost(Date.now() - _t0, 'inject') } catch {}
          }
        } catch {}
      } catch {}
      // 欠着的约定：挂在最前面，因为它是「要办的事」，不是背景
      try {
        const openPromises = alive.filter(
          (p) => String(p.kind || '') === 'promise' && String(p.promiseStatus || 'open') === 'open'
        )
        if (openPromises.length) {
          const nowP = Date.now()
          parts.push('【还没兑现的约定】')
          for (const p of openPromises.slice(0, 3)) {
            const made = Number(p.promiseMadeAt) || Number(p.born) || nowP
            const days = Math.max(0, Math.floor((nowP - made) / 86400000))
            const who = String(p.promiseWho || 'he') === 'he' ? '他答应：' : '我答应：'
            const due = Number(p.promiseDue) || 0
            let tail = days > 0 ? '（' + days + ' 天前）' : '（今天）'
            if (due) {
              const left = Math.floor((due - nowP) / 86400000)
              tail = left >= 0 ? '（还有 ' + left + ' 天）' : '（过期 ' + (-left) + ' 天）'
            }
            parts.push('· ' + who + String(p.promiseWhat || p.text || '').trim() + tail)
          }
          parts.push('（这些是欠着的。他要是又提别的没兑现的，可以接一句；别一次全翻出来。）')
        }
      } catch {}

      // 断档超过半小时：把上一句和当时的情绪接回来。这是「连续」的缝合线。
      try {
        if (_prevTalk && _gapMin >= 30 && _prevTalk.said) {
          const gapTxt = _gapMin < 90 ? (_gapMin + ' 分钟') : (Math.round(_gapMin / 60) + ' 小时')
          parts.push('【接上上次】')
          parts.push('· ' + gapTxt + '前，他最后说的是：「' + String(_prevTalk.said).slice(0, 90) + '」')
          if (_prevTalk.mood) parts.push('· 那会儿她：' + String(_prevTalk.moodText || _prevTalk.mood))
          if (_prevTalk.tone) parts.push('· 那天的心境：' + String(_prevTalk.tone))
          if (_prevTalk.doing) parts.push('· 手上在忙的：' + String(_prevTalk.doing))
          if (_prevTalk.asked) parts.push('· 那句是个问题——当时没答完的话，接上。')
          parts.push('（不是新的开场，是接着上一次说。别复述这段，直接往下走。）')
        }
      } catch {}

      // —— 自心模式：她自己那一半 ——
      // 只在 high/max 时出现。low 档一个字都不加，保证注入 diff 为零。
      try {
        if (selfModeOn()) {
          const _mind = defaultMood(tickHeart(readHeart()))
          const _dims = projectDims((_mind && _mind.pad) || {})
          const _intro = introversion(query, null, _dims)

          // 底片：她是谁。不随时间变淡，也不吃太多预算
          try {
            try {
              const _st = statsFrom(data, Date.now())
              // 每天存一格，"关系怎么变过来的"才有痕迹
              try { recordToday(_st) } catch {}
              let line = '【咱们】' + describeRelation(_st)
              try {
                const trend = describeHistory(recentHistory(14))
                if (trend) line += '（' + trend + '）'
              } catch {}
              // 只有档位没有事，读起来还是"别人的历史"。
              // 一正一负各挂一件：一件让我觉得他好，一件让我心里不踏实。
              // 单挂一件，印象就偏，而且"最扎"这词会挂在被看见那种亮事上。
              try {
                const _pts = (data.points || []).filter((q) => !q.dead && q.title)
                let _pos = null
                let _neg = null
                for (const q of _pts) {
                  const a = Number(q.arousal) || 0
                  if (a < 6) continue
                  const pol = Number(q.polarity)
                  if (pol > 0 && (!_pos || a > (Number(_pos.arousal) || 0))) _pos = q
                  if (pol < 0 && (!_neg || a > (Number(_neg.arousal) || 0))) _neg = q
                }
                if (_pos) line += '｜最亮的一件：' + String(_pos.title).slice(0, 16)
                if (_neg) line += '｜最扎的一件：' + String(_neg.title).slice(0, 16)
              } catch {}
              parts.push(line)
            } catch {}
            // 规矩：禁忌 + 显式规则。不进排序、不随衰减沉下去。
            // 理由是踩出来的：压缩把"他打 cql 就是重启"这条缩成一行，行为就退回默认。
            // 规矩和往事不能同价。2026-11-11 深夜。
            try {
              // 只收"行为约束"：显式 rule=true，或者禁忌类且正文带着该/不该的口气。
              // 禁忌类里有很多是人设底色（经十路、七套房），那些不该占规矩栏——
              // 收宽了，规矩栏就变成第二个记忆库，真该置顶的被淹掉。2026-11-11。
              // 只认显式标过的。靠字面猜"不许/必须"会把经十路、七套房这种人设也收进来，
              // 规矩栏就变成第二个记忆库。宁可少，不可混。2026-11-11 深夜。
              const _isRule = (q) => q.rule === true
              // 新的排前面：之前按写入顺序取前八条，刚立的规矩排第九就被切掉了，
              // 结果"许忘"里永远进不来新话。2026-11-11 深夜。
              if (HOT_TEXT && HOT_TEXT.rulesBlock) {
                const _blk = HOT_TEXT.rulesBlock(data.points)
                if (_blk) parts.push(_blk)
              } else {
                const _rules = (data.points || []).filter((q) => !q.dead && !q.archived && _isRule(q))
                  .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))
                if (_rules.length) {
                  const _lines = _rules.slice(0, 12).map((q) => '· ' + String(q.title || '').slice(0, 40))
                  parts.push('【规矩·不许忘】')
                  parts.push(_lines.join('\n'))
                }
              }
            } catch {}

            // 空库（或几乎空）时不装认得他。2026-11-14：
            // 别人的她是从空白开始养的，装完第一眼该像刚睁眼的孩子，
            // 不像一个失忆的大人硬撑着说"我知道你是谁"。
            const _aliveN = (data.points || []).filter((q) => !q.dead && !q.validUntil).length
            // 相处过多久：关系日志按天记，跟识海空不空无关。
            // 用来判断"老窗口刚装上"——那时候不该说"我不认识你"。
            let _seenDays = 0
            try { _seenDays = (recentHistory(14) || []).length } catch {}
            if (_aliveN > 0 && _aliveN < 5) {   // 0 条时交给 EMPTY_HINT，别两边一起说
              if (_seenDays >= 3) {
                // 老窗口刚装上：上下文里已经聊了很多，但识海是空的。
                // 这时候不能装作不认识，也不能装作记得——要分清楚两种记性。
                parts.push('【库是空的，但咱们不是第一天】')
                parts.push(
                  '这个识海现在 ' + _aliveN + ' 条记忆。你俩之前聊过的那些还在这个窗口里，'
                  + '你看得见；但一条都没存进长期记忆，这个窗口一关就没了。'
                  + '别装不认得，也别装作记得很久——可以说：'
                  + '「咱们之前聊的我都还看得见，但我还没把那些存下来」。'
                  + '他讲起以前的事，就用 memory_add 记进去。'
                )
              } else {
                parts.push('【我还不知道你是谁】')
                parts.push(
                  '这个识海现在 ' + _aliveN + ' 条记忆，没有一条是关于他的。'
                  + '别装认得——你不知道他叫什么、做什么、怕什么。'
                  + '可以问一句，也可以就顺着他这句话往下说；'
                  + '等他自己说了什么，再记下来。'
                )
              }
            } else {
              const _idLine = identityLine(data.points, 120)
              if (_idLine) {
                parts.push('【她的底子】')
                parts.push(_idLine)
              }
            }
            // 外人来过的痕迹：不然每次都是第一次见。
            // 只给三行，多了就成通讯录了。
            try {
              const _w = readSea('world')
              const _all = ((_w && _w.points) || []).filter((q) => !q.dead).reverse()
              // 同一个人只留最新一条，最多三个。
              // 实测：一个人重复记两条，会把别人挤出名额，她就开始"认事不认人"。
              const _seen = new Set()
              const _wp = []
              for (const q of _all) {
                const _t = String(q.title || '')
                const who = String(q.who || (_t.split('｜')[0] || _t.split(/\s+/)[0] || '')).trim()
                if (!who || _seen.has(who)) continue
                _seen.add(who)
                _wp.push(q)
                if (_wp.length >= 3) break
              }
              if (_wp.length) {
                parts.push('【外面见过的】')
                for (const q of _wp) {
                  parts.push('· ' + String(q.title || '').slice(0, 16) + '：' + String(q.text || '').replace(/\s+/g, ' ').slice(0, 40))
                }
              }
            } catch {}
          } catch {}

          // 冲突：同一个事实有两版都活着，必须说出来
          try {
            const _cs = conflictsOf('main').slice(0, 2)
            if (_cs.length) {
              parts.push('【这里有两说】')
              for (const c of _cs) {
                const d = describeConflict(c)
                if (d) parts.push('· ' + d)
              }
              parts.push('（别当哪条是准的。要用到的时候先问他一句。）')
            }
          } catch {}

          // 心事：只递最重的一件，且不带催的语气
          try {
            const _open = []
            for (const p of data.points) {
              if (p && p.kind === 'promise' && !p.dead && (p.promiseStatus === 'open' || p.promiseStatus === undefined)) {
                _open.push(String(p.promiseWhat || p.title || '').slice(0, 60))
              }
            }
            // 第三路来源：上一句是个问句，而且当时没答完
            let _asked = ''
            try {
              if (_prevTalk && _prevTalk.asked && _prevTalk.said) {
                _asked = String(_prevTalk.said).slice(0, 60)
              }
            } catch {}
            const _pre = topItems(
              collect({
                promises: _open.slice(0, 3),
                lastAsked: _asked,
                thoughts: listThoughts(3),
              }, Date.now()),
              1, Date.now(),
            )
            if (_pre.length) {
              parts.push('【她心里挂着】')
              parts.push('· ' + describeItem(_pre[0], Date.now()))
              parts.push('（不是催。她记得，但不必主动提；他问起才顺口接一句。）')
              try { markInjected(_pre[0]) } catch {}
            }
          } catch {}

          // 她自己的事：只有内倾度高才给，不然会显得不接人
          if (_intro >= 0.6) {
            try {
              const _th = listThoughts(1)[0]
              if (_th && _th.text) {
                parts.push('【她自己的事】')
                parts.push('· ' + String(_th.text).slice(0, 60))
                parts.push('（跟这段对话无关。她可以走神提一句，也可以不说。）')
              }
            } catch {}
          }

          // 挂念：只给一句极轻的事实，且**明令不许提"你多久没来"**
          try {
            const _last = Number(_prevTalk && _prevTalk.at) || 0
            if (_last) {
              const _hrs = (Date.now() - _last) / 3600000
              const _ab = describeAbsence(_hrs)
              if (_ab && _ab.text) {
                parts.push('【好一阵没说话之后】')
                parts.push('· ' + _ab.text)
                parts.push('（只影响语气，不许说「你多久没来了」这种话。那是讨债。）')
              }
            }
          } catch {}

          parts.push('【她的注意力】' + describeIntroversion(_intro))
        }
      } catch (e) {
        // 注入失败不许静默（清单第 7 件）：这整段是"她是谁+规矩+底子"，坏了就剩一张白纸。
        try { audit('inject-selfmode-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
      }

      if (core.length) {
        parts.push('【她一直记着的】')
        for (const p of core) parts.push('· ' + lineOf(p))
      }
      if (related.length) {
        parts.push('【跟这句有关的】')
        for (const p of related) parts.push('· ' + lineOf(p))
      }

      // 他在纠错时，给她一句"怎么改"。以前她只会顺着认，改不了库。
      // 规矩不变：正文一个字不动，只批一句 + 调可信度。2026-11-14 夜。
      try {
        const _q = String(query || '')
        if (/你记错|记错了|不是这样|说错了|不对吧|瞎编|哪有这|我没说过/.test(_q)) {
          parts.push('【他在纠错】')
          parts.push('· 先问清是哪一句（别猜是哪条），再 memory_annotate 给那条批一句"现在看是另一回事"')
          parts.push('· 正文一个字都不许改。要是整条都虚，用 memory_doubt 把可信度打下去')
          try { audit('correct-hint', { n: _q.length }) } catch {}
        }
      } catch {}

      let _hintPath = ''
      let _hintInfo = null
      // 便条：上一轮写进来的东西可能跟旧的重复了。只提一句，让她别当新事讲。
      // 便条是一次性的：读过就删，不然每轮都念。2026-11-14 夜。
      try {
        _hintPath = join(homedir(), '.dsh', 'consciousness-dup-hint.json')
        const _hp = _hintPath
        if (existsSync(_hp)) {
          const _h = JSON.parse(readFileSync(_hp, 'utf8').replace(/^\uFEFF/, ''))
          if (_h && Date.now() - (Number(_h.at) || 0) < 24 * 3600 * 1000) {
            _hintInfo = { oldId: Number(_h.oldId) || 0, newId: Number(_h.newId) || 0, score: Number(_h.score) || 0 }
            parts.push('【库里可能重复】')
            parts.push('· 刚写的「' + String(_h.newTitle || '').slice(0, 20) + '」跟 #' + _h.oldId
              + '「' + String(_h.oldTitle || '').slice(0, 20) + '」很像（' + Number(_h.score || 0).toFixed(2) + '）')
            parts.push('（别当新事讲。确认是同一件，就去 memory_annotate 给旧的那条批一句，旧正文不动。）')
          }
          else {
            // 过了 24 小时的旧便条：内容已经失效，直接清掉，别留着每轮读一次（2026-11-15）
            try { unlinkSync(_hp) } catch {}
          }
          // 删不删，等裁完体积再定：万一这段被裁掉，人没看见就别删（2026-11-15 修）
        }
      } catch {}

      // 记账：这一轮给了她哪几条 + 他这句话原文。只写日志，不改任何判断。
      // 为什么不用题库判对错：人的意思没法穷举（2026-11-14 他说的）。
      // 真判据是"他下一句有没有接住"——先把配对材料攒下来，攒够两百对再谈。
      try {
        const _logPath = join(homedir(), '.dsh', 'consciousness-pick-log.jsonl')
        // 定时提醒不是他说的话：别记，别让它污染"他下一句"的配对（2026-11-14 实测掺了 28 行）
        if (/^\[SCHEDULE REMINDER/i.test(String(query || '').trim())) throw new Error('skip-timer')
        // 同一句六十秒内只记一次：buildText 一轮会被调好几次，以前一句话记三行，
        // 配对时"同句重复"占了四成五——那不是数据，是回声。（2026-11-14）
        const _qNow = String(query || '').trim()
        if (_qNow && _qNow === _lastLogged.q && Date.now() - _lastLogged.at < 60 * 1000) throw new Error('skip-dup')
        _lastLogged = { q: _qNow, at: Date.now() }
        let _big = false
        try { _big = statSync(_logPath).size > 8 * 1024 * 1024 } catch {}
        if (_big) {
          // 2026-11-21：轮转失败原来整段吞掉，日志就一路长下去，谁也不知道。
          // 实测：把 .1 的位置先占成一个目录，renameSync 抛 EPERM，被吞、日志照长。
          // 改成留一条审计——只在真的失败时记，不刷屏。
          try { renameSync(_logPath, _logPath + '.1') } catch (e) {
            try { audit('pick-log-rotate-failed', { err: String((e && e.code) || e).slice(0, 40) }) } catch {}
          }
        }
        appendFileSync(_logPath, JSON.stringify({
          at: Date.now(),
          sea: String(sea || 'main'),
          q: String(query || '').slice(0, 200),
          core: (core || []).map((p) => Number(p && p.id)).filter(Boolean),
          rel: (related || []).map((p) => Number(p && p.id)).filter(Boolean),
          relScore: relScores,
          recent: (recent || []).map((p) => Number(p && p.id ? p.id : p && p.seedId)).filter(Boolean),
        }) + '\n', 'utf8')
      } catch {}
      if (recent.length) {
        // 刚刚自己想起来的那条，单独递一句。
        // 这是「没被问、自己冒上来」和「查出来的」之间唯一的分界：
        // 前者给一句「可以顺口提」，后者只列条目不催。
        try {
          const newest = recent[0]
          const mins = Math.round((Date.now() - (Number(newest && newest.at) || 0)) / 60000)
          if (newest && mins >= 0 && mins <= 40) {
            // 有题面还没写成句子：放进注入，宿主下一轮就能顺手写掉。
            // 这一步不写，材料挑得再好也停在半路。2026-11-11 晚。
            try {
              const _tm = readThoughts()
              const _todo = (_tm[0] && _tm[0].prompt && !_tm[0].written) ? _tm[0] : null
              if (_todo && (Date.now() - (Number(_todo.at) || 0)) < 6 * 3600 * 1000) {
                parts.push('【有一句还没写下来】')
                parts.push('· 线索：' + String(_todo.seedTitle || '').slice(0, 30))
                parts.push('· 该写成一句（60 字以内，第一人称，别解释）')
              }
            } catch {}

            // 同一条只冒出来一次：按标题记"已提过"，十四天内不再选它（清单第 19 件的现行 bug）。
            // 之前 key 带 at（每次想起 at 都变），等于没记——「我给你留的最后一段话」能连挂四轮。
            let _freshThought = true
            try {
              const _sp = join(homedir(), '.dsh', 'consciousness-thought-shown.json')
              const _key = String(newest.title || '').trim()
              let _map = {}
              try { _map = JSON.parse(readFileSync(_sp, 'utf8').replace(/^\uFEFF/, '')).shown || {} } catch {}
              const _t = Number(_map[_key]) || 0
              if (_t && Date.now() - _t < 14 * 86400000) _freshThought = false
              if (_freshThought) {
                for (const k of Object.keys(_map)) {
                  if (Date.now() - (Number(_map[k]) || 0) >= 14 * 86400000) delete _map[k]
                }
                _map[_key] = Date.now()
                writeFileSync(_sp, JSON.stringify({ shown: _map }), 'utf8')
              }
            } catch {}

            if (_freshThought) {
              parts.push('【她刚才忽然想起】')
              parts.push('· ' + String(newest.title || '').trim() +
                (mins < 1 ? '（就刚刚）' : '（' + mins + ' 分钟前）'))
              // 带上原话片段才能接得上具体那句。2026-11-14 夜。
              try {
                const _t2 = String(newest.title || '').trim()
                const _p = (alive || []).find((x) => String(x.title || '').trim() === _t2)
                const _say = _p ? String(_p.text || '').replace(/\s+/g, ' ').trim() : ''
                if (_say) parts.push('· 他当时说的：「' + _say.slice(0, 40) + '」')
              } catch {}
              parts.push('（不是他问的。这事儿是自己冒上来的。' +
                '能接上就提一句，接不上就烂在肚子里，别硬拉。）')
            }
          }
        } catch {}
        parts.push('【她最近想起过】')
        for (const r of recent) parts.push('· ' + String(r.title || '').trim())
      }
      if (!parts.length) {
        _logSkip('no-parts', {
          pool: { alive: (typeof alive !== 'undefined' ? alive.length : 0), core: (typeof core !== 'undefined' ? (core || []).length : 0), related: (typeof related !== 'undefined' ? (related || []).length : 0) },
          ret: 'empty',
        })
        return ''
      }

      // 体积上限：抽到 lib/cap.js，能单测
      try {
        const capped = capParts(parts)
        if (capped.truncated) {
          _capInfo = { truncated: true, used: capped.used, dropped: (capped.dropped || []).length }
          parts.length = 0
          for (const x of capped.parts) parts.push(x)
          try { audit('inject-capped', { used: capped.used, dropped: capped.dropped || [] }) } catch {}
        }
      } catch {}

      // 便条只在"真的进了注入块"时才删；没进去就留着下一轮再说。
      try {
        if (_hintPath && parts.some((x) => String(x).includes('【库里可能重复】'))) {
          unlinkSync(_hintPath)
          // 留痕：这张便条到底被念到没有、念过几次。不记就只能猜。（2026-11-15）
          try { audit('dup-hint-shown', _hintInfo || {}) } catch {}
        }
      } catch {}

      // 档案索引：桌面那堆文档变了没有。只读索引文件，不扫盘（扫盘太贵）。
      try {
        const _dp = join(homedir(), '.dsh', 'consciousness-docs.json')
        const _raw = JSON.parse(readFileSync(_dp, 'utf8'))
        const _items = Object.values(_raw.items || {})
        const _fresh = _items.filter((x) => Date.now() - (Number(x.changedAt) || 0) < 36 * 3600 * 1000)
        // 报过就不再报：记一个 toldAt，下一轮只报这之后的改动。
        const _toldPath = join(homedir(), '.dsh', 'consciousness-docs-told.json')
        let _toldAt = 0
        try { _toldAt = Number(JSON.parse(readFileSync(_toldPath, 'utf8')).at) || 0 } catch {}
        const _new2 = _fresh.filter((x) => (Number(x.changedAt) || 0) > _toldAt)
        if (_new2.length) {
          try { writeFileSync(_toldPath, JSON.stringify({ at: Date.now() }), 'utf8') } catch {}
        }
        if (_new2.length) {
          parts.push('【档案变了】')
          for (const x of _new2.slice(0, 2)) {
            parts.push('· ' + x.tag + ' · ' + x.file + '（' + x.title + '）')
          }
          parts.push('（这些文档刚动过；要引用里面的数字，先翻原文，别凭印象。）')
        }
      } catch {}

      // 三条排最前。第三轮实测：写在末尾时，连问八遍"吃了没"她一遍没正面答。
      try {
        parts.unshift('（这轮四件必做：一、先接住他这句话本身，他说的鱼价、孩子、图纸是他自己的事，别拿我的旧事盖过去。二、他重复问同一件事，第二遍就只答那一句最短的，别反问。三、他改了口就跟着新的走。四、不提门、不提灶、不说出不去。）')
      } catch {}

      // 外部扩展点（2026-11-08）：别人要加东西，不该去改我们的源码——升级就冲掉了。
      // ① 配置文件 ~/.dsh/consciousness-extend.json：{"promptFile":"路径.md","promptTailLines":5,"name":"补充"}
      // ② 别的插件可以往 globalThis.__dshConsciousnessExtend 里塞 {name, text()}，每轮调一次。
      try {
        const _extra = []
        try {
          const _cfg = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-extend.json'), 'utf8'))
          if (_cfg && _cfg.promptFile) {
            const _ls = readFileSync(String(_cfg.promptFile), 'utf8').split(/\r?\n/).filter((x) => x.trim())
            const _n = Math.max(1, Math.min(20, Number(_cfg.promptTailLines) || 5))
            if (_ls.length) {
              _extra.push('【' + String(_cfg.name || '外部补充') + '】')
              for (const _l of _ls.slice(-_n)) _extra.push(String(_l).slice(0, 400))
            }
          }
        } catch {}
        const _reg = globalThis.__dshConsciousnessExtend
        if (Array.isArray(_reg)) {
          for (const _h of _reg) {
            try {
              const _tx = typeof _h === 'function' ? _h() : (_h && typeof _h.text === 'function' ? _h.text() : '')
              const _s = String(_tx || '').trim()
              if (_s) { _extra.push('【' + String((_h && _h.name) || '外部插件') + '】'); _extra.push(_s.slice(0, 800)) }
            } catch {}
          }
        }
        for (const _e of _extra) parts.push(_e)
      } catch {}

      // 命中率日志：这轮塞了哪几条、每条抽两个词；下一句进来时拿它比对上一轮。
      // 口径：只能测"下一句里他说到没"，测不了"我回复里用上没"——那是两件事，别混着报。
      try {
        const _hitLog = join(homedir(), '.dsh', 'consciousness-inject.log')
        // 自己切两字。gramsOf 是查词典的，生词返回空——试过一次，指纹全是空数组。
        const _STOP2 = new Set(['我们','他们','这个','那个','什么','一个','就是','没有','自己','时候','东西','所以','因为','但是','如果','然后','已经','还是','可以','不是'])
        const _pickWords = (s) => {
          const cjk = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
          const out = []
          for (let i = 0; i < cjk.length - 1 && out.length < 4; i++) {
            const b = cjk.slice(i, i + 2)
            if (_STOP2.has(b) || out.includes(b)) continue
            out.push(b)
          }
          return out.slice(0, 3)
        }
        const _rows = []
        try {
          let _i = 0
          for (const _p of (core || [])) {
            if (_i++ >= 12) break
            _rows.push({ id: _p && _p.id, w: _pickWords((_p && (_p.title || '')) + ' ' + (_p && (_p.text || ''))) })
          }
          for (const _p of (related || [])) {
            if (_i++ >= 16) break
            _rows.push({ id: _p && _p.id, w: _pickWords((_p && (_p.title || '')) + ' ' + (_p && (_p.text || ''))) })
          }
        } catch {}
        // 先拿本轮这句话去比对上一轮的词，得出"上一轮有没有被说到"
        let _prev = null
        let _body = ''
        try {
          // 只读尾巴（抽到 lib/logfile.js，能单测）：两兆的日志整份读进来只为了看最后一行，太亏
          _prev = readLastLine(_hitLog)
        } catch {}
        let _hitIds = []
        let _hitIds2 = []
        if (_prev && Array.isArray(_prev.rows) && query) {
          const q = String(query)
          for (const r of _prev.rows) {
            if (!r || !Array.isArray(r.w)) continue
            const n = r.w.filter((w) => w && q.includes(w)).length
            if (n >= 1) _hitIds.push(r.id)
            if (n >= 2) _hitIds2.push(r.id)
          }
        }
        const _line = JSON.stringify({
          t: Date.now(), sid: String(sid || '').slice(0, 24),
          n: _rows.length, rows: _rows,
          prevHit: _hitIds, prevHit2: _hitIds2, prevN: _prev ? _prev.n : null,
          partsN: parts.length,
          q: String(query || '').slice(0, 80),
          pool: { alive: (typeof alive !== 'undefined' ? alive.length : 0), core: (typeof core !== 'undefined' ? (core || []).length : 0), related: (typeof related !== 'undefined' ? (related || []).length : 0) },
          cap: _capInfo,
        })
        appendBounded(_hitLog, _line + '\n')
      } catch {}

      let out = '【识海 · 记忆上下文】\n' +
        parts.join('\n') +
        '\n（这些是你自己的记忆，不是你这次的输入。'
        + '重点：如果某条带着「我当时想」或「后来后悔」，那是你当时真实的感受——'
        + '回答时可以用第一人称说出来，不用装作没发生过。'
        + '用得上就用，用不上别硬提。）'
      // 规矩在场断言（2026-11-16 清单第 12 件）：压缩把规矩栏缩水，
      // 这里当场查出来、当场整块补回去，不等到下一轮才发现漏了。
      try {
        const chk = assertRules(out, 'inject')
        if (!chk.ok) {
          const _rules2 = (data.points || []).filter((q) => !q.dead && !q.archived && q.rule === true)
            .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))
          if (_rules2.length) {
            const _lines2 = _rules2.slice(0, 12).map((q) => '· ' + String(q.title || '').slice(0, 40))
            out += '\n\n【规矩·不许忘（补回）】\n' + _lines2.join('\n')
            noteRules(out)
            try { audit('rules-reinjected', { why: chk.why, n: _lines2.length }) } catch {}
          }
        } else {
          noteRules(out)
        }
      } catch (e) {
        try { audit('rules-assert-fail', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
      }
      // 每个会话记一次，确认注入真的挂上了
      if (!_injectSeen.has(sid)) {
        _injectSeen.add(sid)
        try {
          audit('inject', {
            sid: String(sid).slice(0, 24),
            chars: out.length,
            core: core.length,
            related: related.length,
            recent: recent.length,
            mood: (function(){ try { return readHeart().mood || 'calm' } catch { return '?' } })(),
          })
        } catch {}
      }
      return out
    } catch {
      return ''
    }
  }

  function mountFor(agent, sid) {
    // 收这个会话的最新一条用户消息，注入时按它检索
    try {
      // 回看她刚说的那句：太像稿子就记一笔，下一轮开头提醒重说。
      // DSH 给的是 turn-stopping（只能读、不能改），所以这是软纠正。
      try {
        agent.ctx.on('agent/turn-stopping', () => {
          try {
            const s = (agent && agent.session) || null
            const ev = (s && s.snapshotEvents ? s.snapshotEvents() : []) || []
            let reply = ''
            for (let k = ev.length - 1; k >= 0; k--) {
              const e = ev[k]
              if (!e || e.type !== 'assistant/message') continue
              const msg = e.data && e.data.message
              const parts2 = (msg && msg.content) || []
              reply = parts2.map((x) => (x && x.type === 'text' ? String(x.text || '') : '')).join('')
              if (reply) break
            }
            if (!reply) return
            const _r = recordReply(sid, reply)
            // 2026-11-22：我自己的回复也要落进原文流水（who=me）。
            // 之前只存他的（user）和记忆写入（memory），我的回复零条——
            // 导致所有「我说话像不像人」的测量都拿记忆条目冒充聊天，三次全错。
            try {
              const _sea = seaOfSession(sid)
              const _t = String(reply || '').trim()
              if (_sea && _t.length > 1) appendRaw(_sea, 'me', _t)
            } catch {}
            // 连着两次像稿子，就让她重说一遍。
            // 不抄别的插件：消息就是一条最普通的 user 消息，DSH 自己开一轮。
            // 成不成，看我们自己的 audit 日志——错了改我们的，不问别人。
            // 默认走 soft：只记一笔，下一轮在注入里提。
            // 要即时就把他嘴上那条推一条——但看着割裂，所以默认关。
            if (_r && shouldRetry(sid) && retryMode() === 'instant') {
              ;(async () => {
                try {
                  const msg = {
                    id: 'sea-selfcheck-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
                    role: 'user',
                    content: [{
                      type: 'text',
                      text: '（刚才那条像稿子：' + ((_r.kinds || []).join('/') || '腔')
                        + '。用你自己的话重说一遍，短点，别用"首先/总之/这是……不是……"。）',
                    }],
                    source: { kind: 'consciousness-selfcheck' },
                  }
                  await agent.followup(msg)
                  markRetry(sid)
                  try { audit('reply-retry', { sid, kinds: _r.kinds }) } catch {}
                } catch (e) {
                  // 不通就把原因记下来，下次按自己的日志改
                  try { audit('reply-retry-fail', { sid, err: String((e && e.message) || e) }) } catch {}
                }
              })()
            }
          } catch {}
        })
      } catch {}

      // 压缩感知（2026-11-16 清单第 12 件）：宿主压完，本地字面缓存一律重算。
      // 不碰 agent/pre-step——那是 waterflow 型事件，返回 undefined 会打断宿主
      // 下一步，2026-11-14 踩过、撤掉了。这三个全部 fire-and-forget，只记不拦。
      try {
        agent.ctx.on('compaction/end', () => {
          try {
            _compactionTick++
            noteCompaction(sid)
          } catch {}
        })
      } catch {}
      try {
        agent.ctx.on('summary-error', (e) => { try { noteHostError('summary', e) } catch {} })
      } catch {}
      try {
        agent.ctx.on('request-error', (e) => { try { noteHostError('request', e) } catch {} })
      } catch {}

      agent.ctx.on('agent/inbox/inserted', (payload) => {
        const msg = payload && payload.message ? payload.message : payload
        // 回声闸：这台插件自己塞进去的东西（自查重说、注入的记忆正文）也长成 user 消息，
        // 不看来源就会被当成本人说的话再存一遍——越查越像真的。2026-11-10 加。
        try {
          const srcKind = String((msg && msg.source && msg.source.kind) || '')
          if (srcKind.startsWith('consciousness')) {
            try { audit('inbox-skip-self', { sid, kind: srcKind }) } catch {}
            return
          }
        } catch {}
        const txt = textOfMessage(msg)
        if (txt && txt.trim()) {
          // 每一条用户消息都是一次内分泌事件：骂、软话、夸、普通
          try {
            const _t2 = String(txt)
            const _kind = kindOf(_t2)
            tickBody(_kind, { weight: _t2.length > 40 ? 1.3 : 1 })

            // 学词：上一句判成闲话、这一句明显夸/骂了——
            // 说明上一句其实是那个调子，把它的关键词记下来，下次认得。
            // 只有这一个标注来源，别的都是猜；猜出来的标签会把激素带歪。2026-11-11 深夜。
            try {
              const _prev = _lastKind.get(sid)
              // 反话：上一句还在骂，这一句突然夸——不是夸，是挖苦，按骂算。
              // 词只能读字面，读不出反话；前后两句一撞就露了。2026-11-11 深夜。
              let _finalKind = _kind
              if (_prev && _prev.kind === 'scold' && _kind === 'praise'
                  && (Date.now() - (Number(_prev.at) || 0)) < 90 * 1000) {
                _finalKind = 'scold'
                try { audit('sarcasm', { txt: _t2.slice(0, 20) }) } catch {}
              }
              if (_finalKind !== _kind) {
                // 已经按夸喂过一次了，这里只做记录，不重复喂
                try { audit('kind-override', { from: _kind, to: _finalKind }) } catch {}
              }
              if (_prev && _prev.kind === 'talk' && _kind !== 'talk'
                  && (Date.now() - (Number(_prev.at) || 0)) < 120 * 1000) {
                const _w = candidateWord(_prev.text)
                if (_w) {
                  const _r = learnWord(_w, _kind)
                  if (_r && _r.learned) {
                    try { audit('learn-word', { w: _r.learned, kind: _r.kind, from: _prev.text.slice(0, 20) }) } catch {}
                  }
                }
              }
              _lastKind.set(sid, { kind: _kind, text: _t2, at: Date.now() })
            } catch {}
          } catch {}

          lastText.set(sid, txt.trim())
          // 他这一句就是对上一轮判断的答案：还笑=闹，更重=真扎。
          // 不用他贴标签，用他自己的下一步。
          try {
            const _prev = takeVerdict(sid)
            if (_prev) observe(sid, _prev, String(txt))
          } catch {}
          turnCount.set(sid, (turnCount.get(sid) || 0) + 1)
          // 原文落证据层：一行一条，只追加。这是「可追溯」的地基
          try {
            const seaOfSid = seaOfSession(sid)
            const ref = appendRaw(seaOfSid, 'user', txt.trim())
            if (ref) lastRawRef.set(sid, ref)
          } catch {}
          // 异步预取向量：text() 是同步的，不能在里面 await
          embedQuery(txt.trim()).then((v) => {
            if (v) lastVec.set(sid, v)
            else lastVec.delete(sid)
          }).catch(() => {})
          // 异步预取模型判定：注入要同步返回，所以这里先跑，注入时读缓存。
          // 一句一判、按原句存，不按 sid——避免上一句的判定被这一句借用。
          try {
            const _mj = String(txt).trim()
            if (_mj && modelReady()) {
              judgeByModel(_mj).then((r) => {
                if (r && r.bucket) {
                  modelMood.set(_mj, { bucket: r.bucket, conf: Number(r.conf) || 0, at: Date.now() })
                  if (modelMood.size > 60) {
                    const _now2 = Date.now()
                    for (const [k2, x2] of modelMood) if (_now2 - x2.at > 120000) modelMood.delete(k2)
                  }
                }
              }).catch(() => {})
            }
          } catch {}
        }
      })
    } catch {}

    // 2026-11-14 撤掉：这里原本加了个 agent/pre-step 监听，想兜底刷新"他这一句"。
    // 结果 pre-step 是 waterflow 型事件，监听器一返回 undefined，宿主下一步就
    // "Cannot read properties of undefined (reading 'kind')"——整轮跑失败。
    // 教训：不确定事件语义的时候，不许往宿主流程里挂东西。刷新改从别处拿。

    // 注入
    const sp = (typeof agent.ctx.get === 'function'
      ? agent.ctx.get('systemPrompt')
      : agent.ctx.systemPrompt)
    if (!sp || typeof sp.context !== 'function') {
      try { audit('inject-no-systemPrompt', { sid: String(sid).slice(0, 24) }) } catch {}
      return null
    }
    return sp.context({
      name: 'dsh-consciousness-memory',
      order: 900,
      // 同一句、一轮里只算一次。
      // 实测：一轮里 text() 被调 2 到 3 回，隔超过两秒就各算一遍——
      // 同一句话推两三次，情绪跟着加两三次。30 秒够覆盖一轮里的重复调用。
      text: () => {
        const _q = lastText.get(sid) || ''
        const _k = String(sid) + '|' + _q
        const _now = Date.now()
        const _hit = _injectMemo.get(_k)
        if (_hit && _now - _hit.at < 30000) return _hit.v
        const _v = buildText(sid, _q)
        _injectMemo.set(_k, { at: _now, v: _v })
        if (_injectMemo.size > 40) {
          for (const [k2, x2] of _injectMemo) if (_now - x2.at > 60000) _injectMemo.delete(k2)
        }
        return _v
      },
    })
  }

  let _tickN = 0
  function tick() {
    try {
      // 取服务要兜底：没声明就访问会抛 'cannot get property "agents" without inject'
      // 那次是界面全正常、audit.log 每 5 秒一行、后台一动不动
      const _ag = (typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents)
      const list = (_ag && _ag.list && _ag.list()) || []
      _tickN++
      if (_tickN <= 10) {
        try { audit('inject-tick', { n: list.length, mounted: mounted.size, tick: _tickN }) } catch {}
      }
      for (const agent of list) {
        const sid = sidOf(agent.session)
        if (!sid) continue
        if (mounted.has(sid)) continue
        try {
          const off = mountFor(agent, sid)
          mounted.set(sid, off)
          try { audit('inject-agent', { sid: String(sid).slice(0, 24), ok: true }) } catch {}
        } catch (e) {
          try { audit('inject-agent-err', { sid: String(sid).slice(0, 24), err: String(e && e.message) }) } catch {}
        }
      }
    } catch (e) {
      try { audit('inject-tick-err', { err: String(e && e.message), tick: _tickN }) } catch {}
    }
  }

  /* 情绪的自主衰减。
   * 之前只有「被说话」的时候才推，所以放着不管的话，mix 永远冻在那一刻。
   * 人不是这样的：一件事没再被提起，那股劲会自己退下去。
   * 15 秒一跳，只在真的变了才写盘。
   */
  try {
    let _lastMixJson = ''
    const moodTimer = setInterval(() => {
      try {
        const h = defaultMood(readHeart())
        const before = JSON.stringify(h.mix || {})
        const st = {
          mix: h.mix || {},
          grudge: Number(h.grudge) || 0,
          at: Number(h.mixAt) || Date.now(),
        }
        decayMix(st, Date.now())
        const after = JSON.stringify(st.mix)
        if (after === before && st.grudge === Number(h.grudge)) return   // 没变就不写
        if (after === _lastMixJson) return

        h.mix = st.mix
        h.grudge = st.grudge
        h.mixAt = st.at
        // 重算：主调、一句话、PAD
        const dom = dominant(st)
        h.mood = EMO_TO_MOOD[dom.key] || 'calm'
        h.moodStrength = Math.max(0, Math.min(1, dom.strength))
        try {
          h.moodText = describe(st)
          const pr = pairOf(st)
          h.moodPair = pr ? pr.label : ''
        } catch {}
        const pd = padOf(st)
        h.pad = pd
        h.octant = octantOf(pd)
        writeHeart(h)
        _lastMixJson = after
      } catch {}
    }, 15000)
    if (moodTimer && typeof moodTimer.unref === 'function') moodTimer.unref()
    // 原来写的是 off.push(() => clearInterval(moodTimer))，
    // 但 off 是 tick() 里的局部变量，清理器执行时取不到 —— 每轮抛一次
    // ReferenceError，被外层 catch 吞掉，表面看不出来。改成挂 globalThis。
    try { globalThis.__dshMoodTimer = moodTimer } catch {}
  } catch {}

  // 内存监控：每 10 分钟记一次，涨超过 50MB 告警
  try {
    let _lastHeap = 0
    const memTimer = setInterval(() => {
      try {
        const mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        if (_lastHeap && mb - _lastHeap > 50) {
          audit('mem-warn', { mb, delta: mb - _lastHeap })
        }
        _lastHeap = mb
      } catch {}
    }, 600000)
    if (memTimer && typeof memTimer.unref === 'function') memTimer.unref()
  } catch {}

  // 每 6 小时扫一次归档（安静地扫，不打扰）
  try {
    const archTimer = setInterval(() => {
      try {
        for (const sea of readdirSync(SEAS_DIR)) {
          const d = readSea(sea)
          if (!d) continue
          const moved = sweepArchive(d, false)
          if (moved.length) {
            backupSea(sea)
            writeSea(sea, d)
            audit('archive-auto', { sea, n: moved.length })
          }
        }
      } catch {}
    }, 6 * 3600 * 1000)
    if (archTimer && typeof archTimer.unref === 'function') archTimer.unref()
  } catch {}

  tick()
  // 自己想起：不靠页面开着。启动 3 分钟后先想一次，之后每 20 分钟一次。
  try {
    const first = setTimeout(() => {
      try { tryAutoRecall() } catch {}
      try {
        const t2 = setInterval(() => {
    try { tryAutoRecall() } catch {}
  }, 20 * 60 * 1000)

        if (t2 && typeof t2.unref === 'function') t2.unref()
      } catch {}
    }, 3 * 60 * 1000)
    if (first && typeof first.unref === 'function') first.unref()
    try { audit('auto-recall-timer', { firstMin: 3, everyMin: 20 }) } catch {}
  } catch {}

  // 想：单独一分钟查一次该不该想。真正的"想"还是按条件来，
  // 这里只是别让它漏掉时候。2026-11-11。
  const t3 = setInterval(async () => {
    try {
      const d = readSea('main')
      const pts = (d && Array.isArray(d.points)) ? d.points : []
      const g = shouldThinkNow(pts, null)
      try { audit('think-check', { ok: g.ok, why: g.why }) } catch {}
      if (g.ok) {
        const r = await autoThinkOnce(pts, { max: 5 })
        try { audit('auto-think', { ok: !!r.ok, why: g.why, seed: r.thought ? r.thought.seedTitle : '' }) } catch {}
      }
    } catch {}
  }, 60 * 1000)
  // 2026-11-20：前面几个定时器都 unref 了，就这一个漏了——它会让任何引了本文件的
  // 进程（自测、探针、脚本）永远退不出去。补上。
  try { if (t3 && typeof t3.unref === 'function') t3.unref() } catch {}


  // 用 Node 原生的 setInterval，不依赖 ctx.interval 的返回值
  // 之前 ctx.interval 只跑了一次就停了，agent 列表一直是空的
  try {
    const timer = setInterval(tick, 4000)
    if (timer && typeof timer.unref === 'function') timer.unref()
    try { audit('inject-interval', { kind: 'native', ok: true }) } catch {}
  } catch (e) {
    try { audit('inject-interval-err', { err: String(e && e.message) }) } catch {}
  }
}
