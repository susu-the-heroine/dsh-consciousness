/**
 * dsh-consciousness —— 识海
 *
 * 干三件事：
 *   1. 注册工具 memory_add / memory_list / memory_render，直接调 记忆海\add_memory.py
 *      （逻辑只有一份，别的地方改了这里自动跟着走）
 *   2. 开一条路由 /consciousness，在 DSH 这个端口上把识海页面吐出来
 *   3. 数据仍然只有一份：记忆海\意识海.html
 *
 * 为什么走子进程：加记忆要算坐标、连边、去重、重生成触屏版和桌面副本，
 * 这套逻辑已经用 python 写好了，JS 再抄一遍早晚走样。
 */
import { execFile } from 'node:child_process'
import { createSelfUpdate } from './selfupdate.mjs'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, renameSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  retrievability,
  intervalFor,
  initialStability,
  initialDifficulty,
  growStability,
  lapseStability,
  updateDifficulty,
  captureBoost,
  interferenceFactor,
  vividnessOf,
  MIN_STABILITY,
  MAX_STABILITY,
} from './assets/retention.js'
import {
  MOODS, MOOD_LABEL, EMO_TO_MOOD, MOOD_TONE,
  readHeart, writeHeart, tickHeart, defaultMood, applyMood, judgeEmotion,
} from './lib/mood.js'
// buildText 里拼「她这会儿」那段要直接算 mix，所以底层这几个还留着
import { EMOTIONS, decayMix, dominant, padOf, octantOf, say, pairOf, describe } from './assets/emotion.js'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  HOME, HERE, ASSETS, BASE, HTML, SCRIPT, SEAS_DIR, PY_CANDIDATES,
  BACKUP_DIR, HEART_FILE, DICT_PATH, ROLES_FILE, SEA_LINKS,
  AUDIT_FILE, AUDIT_MAX_BYTES, QUALITY_FILE, EMBED_URL, LOCK_TTL,
  ARCHIVE_DAYS, ARCHIVE_IMP, ARCHIVE_R,
} from './lib/paths.js'
import { seaPath, readSea, writeSea, backupSea, readMeta, writeMeta } from './lib/store.js'
import {
  STOP_CHARS, STOP_WORDS, loadDict, segmentWords, gramsOf, SYNONYMS, expandQuery,
} from './lib/text.js'
import { audit } from './lib/log.js'
import { loadVectors, embedQuery, cosine, getIndex, expandByGraph, syncVectors } from './lib/vectors.js'
import { fmtDay, findAnalogy, buildStoryline, findSedimentCandidates, predictRhythm } from './lib/analysis.js'
import { pickPython, run } from './lib/python.js'
import {
  KINDS, kindOf, kindCfg, forgettable, injectMode, isSingleton, isSetting,
} from './lib/kinds.js'
import { decayOf, rawDecayOf, byDecay, FADE_STAGES, stageOf, canRecallDetail } from './lib/decay.js'
import { reinforcePoint } from './lib/reinforce.js'
import { setQuality, qualityRank, qOn } from './lib/quality.js'
import { TIME_WINDOWS, parseTimeWindow, NEG_PATTERNS, parseNegations } from './lib/parse.js'
import { shouldArchive, sweepArchive, unarchive } from './lib/archive.js'
import { rawDir, rawFileFor, appendRaw, readRaw, rawStats, verifyRaw } from './lib/evidence.js'
import { lockPath, acquireWriteLock } from './lib/lock.js'
import { seaForSession, bindSession, seaOfSession } from './lib/session.js'
import { readRoles, writeRoles, roleOfSea, readLinks, writeLinks, bridgedMemories } from './lib/roles.js'
import { confirmTool, doubtTool } from './lib/tools-uncertain.js'
import { thinkTool } from './lib/tools-think.js'
import {
  text, addTool, listTool, searchTool, analogyTool, storyTool, sedimentTool,
  rhythmTool, traceTool, askTool, archiveTool, renderTool, judgeTool, dateTool,
  countTool, synthTool, exportTool, importTool,
  promiseTool, seaTool,
} from './lib/tools.js'
import { tickOnce } from './lib/tick.js'
import { mountRoutes } from './lib/routes.js'
import { LICENSE_ID, LICENSED_TO } from './lib/license.js'
import { temperamentOf, toneFor, underToneFor } from './lib/temperament.js'
import { INJECT_TEXT, mountAutoInject } from './lib/inject.js'
import { currentCount, listSeas, listWorkspaces, listWindows, cachedInfo, ensureSamples } from './lib/seas.js'

async function ensureEmbedService() {
  // 本地模型在，就不起 Python 服务了——向量在进程内算，快、还不占内存（2026-11-12）
  try {
    if (existsSync(join(HERE, 'assets', 'embed', 'model_quantized.onnx'))) {
      if (process.env.DSH_EMBED_SERVER === '1') {
        // 有人非要走服务（调试用），下面照旧
      } else {
        return true
      }
    }
  } catch {}

  // 先探活
  try {
    const r = await fetch('http://127.0.0.1:8931/health', { signal: AbortSignal.timeout(800) })
    if (r.ok) return true
  } catch {}

  // 起一个
  try {
    const py = pickPython() // 与写入同一条候选链：DSH 自带的 python 也算
    if (!existsSync(py)) return false
    const script = join(HERE, 'assets', 'embed_server.py')
    if (!existsSync(script)) return false
    const child = spawn(py, [script, '--port', '8931'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, HF_ENDPOINT: 'https://hf-mirror.com' },
    })
    child.unref()
    _embedProc = child
    return true
  } catch {
    return false
  }
}

/* ---------- 审计日志 ----------
 * 每次写入、检索、删除都留一行。出问题能查，风险文档要求可重建。
 * 按天滚动，保留七天。磁盘不够就停写日志，保护数据库本体。
 */



/* ---------- 归档 ----------
 * 2026-11-07 补。之前只有 dead（手标）和 validUntil（事实失效），没有「淡到该收起来」。
 * 126 条会变 1260 条，全堆在检索池里，噪音越来越多。
 *
 * 归档 ≠ 删除：标记 archived，不进检索，但随时能捞回来。
 * 判据：久未碰 + 低重要度 + 低亮度 + 可遗忘类型。
 */








/* ---------- 类型注册表 ----------
 * 2026-11-07 补。之前 kind 是硬编码 fact/feeling/taboo，
 * 索引、向量、遗忘、注入全走同一套，想加个「偏好」得改四处。
 *
 * 现在一张表决定行为：注册一行 = 新增一种记忆类型。
 * inject: always（每轮必带）/ recall（按话题）/ recent（最近）/ none
 */

/* ---------- 证据层（append-only） ----------
 * 2026-11-07 补。之前 evidence 是写入那一刻从 text 抄的副本，不在可追溯链上。
 * 记歪了查不到原文，说错话拿不出「在第几行」。
 *
 * 现在：每轮对话原文按天落 raw/YYYY-MM-DD.jsonl，一行一条，只追加不修改。
 * evidence 改成 {file, line, quote}——指向原文，不再复制。
 *
 * 三份资料同时指向这个缺口（TencentDB 的 L0、memory-net 的细节层、YY 总纲的 append-only 日记）。
 * 126 条一天能补完；一万条要先把这 126 条重判一遍，补不动。
 */
/* 会话绑到哪个识海：反查所有海的 _meta.json，带 30 秒缓存 */
let _seaOfSidCache = new Map()
let _seaOfSidAt = 0








/* ---------- 写锁 ----------
 * 同一个识海同时只能有一个写。
 * 风险文档：「并发读写数据库锁竞争卡死」
 * 这是进程内锁，跨进程靠 data.json.tmp + rename 的原子性。
 */
/* 跨进程写锁：靠磁盘上的 .lock 文件
 * 进程内锁管不了两个 DSH 窗口，必须落盘
 * 过期时间 60 秒——进程被杀留下的锁不会永久卡住 */



/* ---------- 三档 ----------
 * low  = 只有字面。快的机器、老机器。
 * high = 加向量、加实体。大部分人。（默认）
 * max  = 加图游走、注入全量。好机器、愿意花 token 的人。
 *
 * 风险文档：「三档状态不同步；Max 假放开」
 *   → 全局单一状态源，所有模块读同一个
 */






/* 类比：不是「内容相似」，是「结构像」。
 * 两条记忆讲的事不一样，但它们的处境一样——
 * 比如「你嫌我傻」和「你说我写得太软」，字面不像，但都是「你觉得我不行」。
 *
 * 做法：比较两条记忆的「邻居结构」——连了哪些实体、连了哪些类型的边。
 * 邻居结构像、但内容不像，就是类比。
 */

/* 故事线：她这一路。
 * 不是返回一堆记忆，是按时间把重要的串成一条线。
 * 风险文档：「故事线生成错乱，梦境幻想混入人生主线」
 *   → 主线只用现实事件，梦境单独一栏。
 */

/* 沉淀候选：同一件事反复发生，就该变成一条认识。
 * 风险文档：「沉淀升级虚假触发：简单重复对话算作三次独立印证」
 *   → 印证必须来自不同的日子，同一天说三遍只算一次。
 */

/* 预测：按他的习惯预判。
 * 不是算命，是「按他过去的行为，这会儿大概率在干什么」。
 * 数据来源：记忆的时间戳 + 心脏的 activity。
 */










/* 自动注入：按会话挂一段「记忆上下文」。
 * 每轮对话前，从当前识海里挑：核心层若干条 + 最近想起来的 + 跟这句话相关的。
 */

// 只声明宿主真的有的服务。
// 之前这里写了 systemPrompt 和 agents —— 如果宿主没有这两个，Cordis 会静默跳过整个插件：
// 不报错、不写日志、界面上什么都没有。
// 那两个功能改成运行时探测：有就用，没有就降级。
export const inject = ['tools', 'webServer', 'workspaceRegistry', 'sessions', 'sessionTitle',
                        'agents', 'systemPrompt']

export function apply(ctx) {
  // 加载期间的错，DSH 是静默吞掉的（插件直接消失，界面上一片干净）。
  // 这里包一层，把真实的错写盘，不然永远不知道死在哪。
  try {
    return _applyInner(ctx)
  } catch (e) {
    try {
      writeFileSync(
        join(process.env.USERPROFILE || homedir(), '.dsh', 'consciousness-load-error.txt'),
        new Date().toISOString() + '\n'
          + String((e && e.stack) || e) + '\n',
        'utf8',
      )
    } catch {}
    throw e
  }
}

function _applyInner(ctx) {
  /* 每个 ctx.effect 都单独兜住。
   * Cordis 的 effect 里 fn 一抛，整个 apply 就没了 —— 静默卸载，界面上什么都看不到。
   * 包一层，至少知道是哪个挂的、挂在哪。
   */
  let _effN = 0
  const safeEffect = (fn, tag) => {
    _effN++
    const n = _effN
    if (n <= 5) { try { audit('effect-call', { n, tag: tag || '' }) } catch {} }
    try {
      return ctx.effect(fn)
    } catch (e) {
      try { audit('effect-fail', { n, tag: tag || '', err: String((e && e.message) || e) }) } catch {}
      return () => {}
    }
  }
  // 水印：每份发出的包 ID 不同，泄露了能查到是谁传的
  try { audit('license', { id: LICENSE_ID, to: LICENSED_TO }) } catch {}
  try { audit('boot-0-webServer', { wbType: typeof ctx.webServer, hasReg: !!(ctx.webServer && ctx.webServer.register) }) } catch {}

  /* ---------- 自动注入：每轮把「她记得什么」递进上下文 ----------
   * 走 systemPrompt.context()，不走 section()：
   *   section 拼进系统提示词，一变整段缓存全废（成本 ×20）
   *   context 追加到对话末尾，只有内容变了才追加，缓存一直命中
   * 这是 dsh-fish-memory 用两次实测换来的经验，直接照抄。
   */
  // 向量服务：起来时顺手拉一把，起不来就降级
  try {
    ensureEmbedService().catch(() => {})
  } catch (e) {
    try { audit('embed-autostart-err', { err: String(e && e.message) }) } catch {}
  }

  try {
    try {
      const keys = ctx.agents ? Object.keys(ctx.agents) : []
      const proto = ctx.agents ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.agents) || {}) : []
      audit('inject-mount', {
        ok: true,
        hasAgents: !!ctx.agents,
        keys: keys.slice(0, 20),
        proto: proto.slice(0, 20),
        hasInterval: typeof ctx.interval,
        hasEffect: typeof ctx.effect,
      })
    } catch (e) {
      try { audit('inject-mount', { ok: true, probeErr: String(e && e.message) }) } catch {}
    }
    mountAutoInject(ctx)
  } catch (e) {
    try { audit('inject-mount-err', { err: String(e && e.message), stack: String(e && e.stack).slice(0, 300) }) } catch {}
  }

  // 注入表是启动时一次性收集的，这一行必须尽早进表
  try {
    safeEffect(() =>
      ctx.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          if (table.some((r) => r && typeof r.text === 'string' && r.text.includes('/dsh-consciousness/widget.js'))) return
          table.push({ kind: 'script', placement: 'body', text: INJECT_TEXT })
        } catch {
          /* 忽略 */
        }
      }),
    )
  } catch {
    /* 宿主没有这个事件就跳过，挂件不出现而已 */
  }

  try { audit('boot-1-before-samples', {}) } catch {}
  ensureSamples()

  // 启动后把还没向量化的记忆补上（每次 20 条，补完为止）。
  // 之前向量是手动脚本算的，新写的记忆一直是语义盲区。
  try {
    let round = 0
    const tick2 = async () => {
      try {
        const d2 = readSea('main')
        if (!d2 || round >= 10) return
        const n = await syncVectors('main', d2, 20)
        round++
        if (n > 0) setTimeout(tick2, 2000)
      } catch {}
    }
    setTimeout(tick2, 8000)
  } catch {}

  // 自心模式的后台步进：每 20 分钟跑一格（只在 high/max 档）
  // 这是"活着"真正活着的地方——不调模型，只让数值和线索动起来。
  try {
    // 只许注册一次：插件重载时 apply 会再进一次，不挡就会叠出十几个定时器
    if (globalThis.__dshSelfmindTimer) throw new Error('already-mounted')
    globalThis.__dshSelfmindTimer = true
    let _tickBusy = false
    const _tick = () => {
      if (_tickBusy) return
      try {
        const lv = String(process.env.CONSCIOUSNESS_SELFMIND || '') || undefined
        const on = (() => {
          try {
            const m = JSON.parse(readFileSync(join(homedir(), '.dsh', 'consciousness-selfmode.json'), 'utf8').replace(/^\uFEFF/, ''))
            return m && (m.level === 'high' || m.level === 'max')
          } catch { return false }
        })()
        if (!on) return
        _tickBusy = true
        try { tickOnce('main') } catch (e) {
          try { audit('selfmind-tick-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
        }
        // 安静够久：把"快掉但还值钱"的掂一遍。
        // 我们自己的做法：只涨 strength 的一半，不碰 lastSeen / recallCount / arousal。
        ;(async () => {
          try {
            const { shouldReview, consolidate } = await import('./lib/consolidate.js')
            const { readHeart } = await import('./lib/mood.js')
            const data = readSea('main')
            const h = readHeart()
            if (!shouldReview(data, h && h.updated)) return
            const r = consolidate(data)
            if (r.n > 0) {
              writeSea('main', data)
              try { audit('consolidate', { n: r.n, ids: r.done.map((x) => x.id).slice(0, 12) }) } catch {}
            } else {
              try { audit('consolidate-empty', { reason: r.reason }) } catch {}
            }
          } catch (e) {
            try { audit('consolidate-err', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
          }
        })()

        _tickBusy = false
      } catch {}
    }
    const _t1 = setTimeout(() => { _tick(); setInterval(_tick, 20 * 60 * 1000) }, 90 * 1000)
    try { _t1.unref && _t1.unref() } catch {}

    // 档案同步：开机 3 分钟扫一次，之后每 20 分钟一次。
    // 不扫的话，文件改了索引不知道，注入里那句「档案变了」永远不会出现。
    try {
      // 注意：这里是 ESM，不能用 require（用了会每轮抛 require is not defined，
      // 定时器照注册、同步一次都不成——2026-11-08 就这么空转了四十几分钟才被审计抓到）。
      const _syncOnce = async () => {
        try {
          const { execFile } = await import('node:child_process')
          const path = await import('node:path')
          const url = await import('node:url')
          const here = path.dirname(url.fileURLToPath(import.meta.url))
          await new Promise((resolve, reject) => {
            execFile(process.execPath, [path.join(here, 'scripts', 'sync-docs.mjs')],
              { timeout: 30000 }, (e) => (e ? reject(e) : resolve()))
          })
        } catch (e) {
          try { audit('docs-sync-throw', { err: String((e && e.message) || e).slice(0, 80) }) } catch {}
        }
      }
      _syncOnce()
      const _t2 = setInterval(_syncOnce, 20 * 60 * 1000)
      try { _t2.unref && _t2.unref() } catch {}
      try { audit('docs-sync-timer', { first: '3min' }) } catch {}
    } catch {}
    try { audit('selfmind-tick-timer', { firstSec: 90, everyMin: 20 }) } catch {}
  } catch {}

  // 开一次就查一遍链：原话有没有被改过、被删过。
  // 老行没有哈希，会算成 legacy——这是老实话，不是失败。
  try {
    const v = verifyRaw('main')
    audit('chain-verify', {
      ok: v.ok, files: v.files, lines: v.lines,
      hashed: v.hashed, legacy: v.legacy, problems: (v.problems || []).length,
    })
  } catch (e) {
    try { audit('chain-verify-err', { err: String((e && e.message) || e) }) } catch {}
  }
  try { audit('boot-2-after-samples', {}) } catch {}
  const off = []
  off.push((function(){ try { return ctx.tools.register(addTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'addTool', err: String(e && e.message) }) } catch {} return () => {} } })())
  off.push((function(){ try { return ctx.tools.register(seaTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'seaTool', err: String((e && e.message) || e) }) } catch {} return () => {} } })())
  off.push((function(){ try { return ctx.tools.register(listTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'listTool', err: String(e && e.message) }) } catch {} return () => {} } })())
  off.push((function(){ try { return ctx.tools.register(renderTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'renderTool', err: String(e && e.message) }) } catch {} return () => {} } })())
off.push((function(){ try { return ctx.tools.register(countTool) } catch(e) { try { audit('boot-tool-count-fail', { tool: 'countTool', err: String(e && e.message) }) } catch {} return () => {} } })())
  off.push((function(){ try { return ctx.tools.register(synthTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'synthTool', err: String(e && e.message) }) } catch {} } })())
  off.push((function(){ try { return ctx.tools.register(importTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'importTool', err: String((e && e.message) || e) }) } catch {} return () => {} } })())
  off.push((function(){ try { return ctx.tools.register(exportTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'exportTool', err: String((e && e.message) || e) }) } catch {} return () => {} } })())
  off.push((function(){ try { return ctx.tools.register(searchTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'searchTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(analogyTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'analogyTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(storyTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'storyTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(sedimentTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'sedimentTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(rhythmTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'rhythmTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(traceTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'traceTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(askTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'askTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(archiveTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'archiveTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(judgeTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'judgeTool', err: String(e && e.message) }) } catch {} return () => {} } })())
    off.push((function(){ try { return ctx.tools.register(dateTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'dateTool', err: String(e && e.message) }) } catch {} return () => {} } })())
      off.push((function(){ try { return ctx.tools.register(promiseTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'promiseTool', err: String(e && e.message) }) } catch {} return () => {} } })())
      off.push((function(){ try { return ctx.tools.register(confirmTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'confirmTool', err: String(e && e.message) }) } catch {} return () => {} } })())
      off.push((function(){ try { return ctx.tools.register(thinkTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'thinkTool', err: String(e && e.message) }) } catch {} return () => {} } })())
      off.push((function(){ try { return ctx.tools.register(doubtTool) } catch(e) { try { audit('boot-tool-fail', { tool: 'doubtTool', err: String(e && e.message) }) } catch {} return () => {} } })())
  try { audit('boot-3-tools-ok', { n: off.length }) } catch {}
  try { audit('boot-4-before-routes', { hasWS: !!(ctx.webServer && ctx.webServer.register) }) } catch {}


  // 路由全部搬去 lib/routes.js 了，这里只收返回值
  for (const f of mountRoutes(ctx)) off.push(f)

  return () => {
    for (const f of off) {
      try {
        if (typeof f === 'function') f()
      } catch {
        /* 忽略 */
      }
    }
  }
}


