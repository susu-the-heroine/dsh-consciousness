/**
 * 路由
 * ====
 *
 * 四十七个接口，全在这一个文件里。原先它们挤在 index.js 的
 * _applyInner 作用域里，和工具、检索、注入共用一块命名空间——
 * 改一处崩全局，今晚崩了三次。
 *
 * 现在只接收一个 ctx，返回一组 dispose 函数。
 * 每个注册都包在 safeEffect 里：一个路由挂了不影响别的。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync,
         unlinkSync, rmSync, renameSync, copyFileSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { spontaneousOf, setSpontaneousLevel, nextSpontaneousLevel, LEVELS } from './spontaneous.js'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { createSelfUpdate } from '../selfupdate.mjs'
import { HOME, HERE, ASSETS, BASE, HTML, SEAS_DIR, BACKUP_DIR, HEART_FILE } from './paths.js'
import { isSeaName, seaDataPath, seaPath, readSea, writeSea, backupSea, readMeta, writeMeta } from './store.js'
import { closeAll as closeMirrorAll } from './sqlite-mirror.js'
import { audit } from './log.js'
import { gramsOf } from './text.js'
import { getIndex, embedHealth, loadVectors, vectorStats } from './vectors.js'
import { decayOf, rawDecayOf, byDecay, stageOf, canRecallDetail } from './decay.js'
import { injectMode, isSetting, kindOf } from './kinds.js'
import { fmtDay, findAnalogy, buildStoryline, findSedimentCandidates, predictRhythm } from './analysis.js'
// 2026-11-20：MOOD_LABEL 和 allowSwear 这两处一直在用，却从来没引进来——
// 情绪那条口在「没有 moodText」的分支里会直接抛「没定义」，整条回五百；
// 骂人许可那条更阴：抛了被自家 catch 吞成 null，页面上永远看不出许可。
import { readHeart, writeHeart, tickHeart, defaultMood, applyMood, judgeEmotion, MOOD_LABEL } from './mood.js'
import { allowSwear } from './rage.js'
import { setQuality, qualityRank, qOn, qualityOf } from './quality.js'
import { parseTimeWindow, parseNegations } from './parse.js'
import { shouldArchive, sweepArchive, unarchive } from './archive.js'
import { appendRaw, readRaw, rawStats, verifyRaw } from './evidence.js'
import { acquireWriteLock } from './lock.js'
import { listSeas, listWindows, listWorkspaces, cachedInfo } from './seas.js'
import { bridgedMemories, readLinks, writeLinks } from './roles.js'
import { reinforcePoint } from './reinforce.js'
import { run } from './python.js'
import { LICENSE_ID, LICENSED_TO } from './license.js'
import { readLog, logStats, judgeSearch, calibrationReport } from './searchlog.js'
import { temperamentOf, setTemperament } from './temperament.js'
import { EMOTIONS, decayMix, dominant, padOf, octantOf, say, pairOf, describe } from '../assets/emotion.js'
import { readMode, setLevel } from './selfmode.js'
import { readLive, writeLive, sane, DEFAULTS } from './live.js'
import { readDamp, describeDamp } from './damping.js'
import { listThoughts } from './selfmind.js'
import { topItems, collect } from './preoccupations.js'
import { project as projectDims, describeDims as describeDimsL } from './emotion-lexicon.js'
import { recentDays, describeTrend, recentSeries } from './moodline.js'
import { aiflavor } from './aiflavor.js'
import { listStyle } from './style-store.js'
import { todayActivity } from './activity.js'
import { bodySnapshot, tickBody } from './body.js'
import { localDay } from './day.js'

/** 身体事件的权重：夹在 0.1~3；给了非数字（?w=abc）就当 1。
 *  2026-11-20：原来直接套「取最大最小」，非数字过一遍还是非数字——NaN 一路喂进身体。 */
export function clampWeight(v) {
  const n = Number(v === null || v === undefined || v === '' ? 1 : v)
  if (!Number.isFinite(n)) return 1
  return Math.max(0.1, Math.min(3, n))
}

/** 按名字引一次模块，之后复用同一份。
 *  2026-11-20：这个文件里原来有五处写成「地址尾巴拼当前时间」现引——每请求一次都是新模块，
 *  模块缓存只涨不落。同一件事只该引一次。 */
const _libCache = new Map()
function loadLib(name) {
  if (!_libCache.has(name)) _libCache.set(name, import(new URL('./' + name, import.meta.url).href))
  return _libCache.get(name)
}

export function mountRoutes(ctx) {
  const off = []

  /* 每个注册都单独兜住。
   * Cordis 的 effect 里 fn 一抛，整个 apply 就没了 —— 静默卸载，界面上看不到。
   */
  const safeEffect = (fn, tag) => {
    try {
      return ctx.effect(fn)
    } catch (e) {
      try { audit('route-fail', { tag: tag || '', err: String((e && e.message) || e) }) } catch {}
      return () => {}
    }
  }

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness',
        handler: async (req, res) => {
          if (!existsSync(HTML)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('识海还没建：' + HTML)
            return
          }
          let body = readFileSync(HTML, 'utf8')
          // ?id= 时把内嵌的那份 DATA 换成这个识海自己的，页面代码一个字不用改
          try {
            // 不带 id 就默认 main，否则打开是一份空模板
            const id = new URL(req.url || '/', 'http://x').searchParams.get('id') || 'main'
            if (id) {
              const dataPath = join(SEAS_DIR, id, 'data.json')
              if (!isSeaName(id)) throw new Error('bad sea name')
              if (existsSync(dataPath)) {
                const raw = readFileSync(dataPath, 'utf8').trim()
                const start = body.indexOf('const DATA = ')
                const end = body.indexOf('\n', start)
                if (start >= 0 && end > start) {
                  // 顺带把它活了多少天塞进去：老识海没有 created，就用文件时间倒推
                  let days = 1
                  try {
                    const meta = readMeta(id) || {}
                    let born = meta.created ? Date.parse(String(meta.created)) : NaN
                    if (!Number.isFinite(born)) born = statSync(dataPath).mtimeMs
                    days = Math.max(1, Math.floor((Date.now() - born) / 86400000) + 1)
                  } catch {
                    days = 1
                  }
                  const injected = raw.replace(/^\{/, '{"_age":' + days + ',')
                  body = body.slice(0, start) + 'const DATA = ' + injected + ';' + body.slice(end)
                }
              }
            }
          } catch {
            /* 取不到就吐默认那份 */
          }
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(body)
        },
      }),
    ),
  )

  // /consciousness/body —— 身体面板（单独一页，星图那边一点不占）
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/body',
        handler: async (req, res) => {
          const page = join(ASSETS, '身体.html')
          if (!existsSync(page)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('身体页还没建：' + page)
            return
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(readFileSync(page, 'utf8'))
        },
      }),
    ),
  )

  // /consciousness/body-tick —— 喂一个事件进去，身体才会动
  // kind: praise 被夸 / scold 被骂 / tender 交底 / recall 翻到了 / miss 没翻到 / talk 普通一句
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/body-tick',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const kind = String(u.searchParams.get('kind') || 'talk')
            const weight = clampWeight(u.searchParams.get('w'))
            const ok = ['praise','scold','tender','recall','miss','silence','talk'].includes(kind)
            if (!ok) return send(400, { ok: false, error: 'kind 不认识', kinds: ['praise','scold','tender','recall','miss','silence','talk'] })
            const s = tickBody(kind, { weight })
            send(200, { ok: true, kind, body: { text: '', dims: s && s.dopamine != null ? {
              dopamine: s.dopamine, noradrenaline: s.noradrenaline, cortisol: s.cortisol,
              serotonin: s.serotonin, oxytocin: s.oxytocin } : null } })
          } catch (e) {
            send(200, { ok: false, error: String(e && e.message || e) })
          }
        },
      }),
    ),
  )

  // /consciousness/body-data —— 面板要的口径都在这里算，页面只管画
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/body-data',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = String(u.searchParams.get('sea') || u.searchParams.get('id') || 'main')
            const d = readSea(sea) || {}
            const pts = Array.isArray(d.points) ? d.points : []
            const edges = Array.isArray(d.edges) ? d.edges : []
            const now = Date.now()
            const dayAgo = now - 86400000
            const t7 = now - 7 * 86400000
            const t30 = now - 30 * 86400000
            const tsOf = (p) => {
              const v = p.lastSeen || p.lastActive || p.seen || p.born || 0
              const n = typeof v === 'number' ? v : Date.parse(String(v))
              return Number.isFinite(n) ? n : 0
            }
            let alive = 0, archived = 0, todayNew = 0, active7 = 0, fading30 = 0, bottom = 0, sumS = 0, nS = 0
            let todayChars = 0, todayEdges = 0
            let newest = 0, newestTitle = ''
            for (const p of pts) {
              if (p && (p.dead || p.archived)) archived++
              else {
                alive++
                const s = Number(p.strength != null ? p.strength : (p.imp || 0) * 100) || 0
                sumS += s; nS++
                const ts = tsOf(p)
                if (ts && ts >= dayAgo) {
                  todayNew++
                  try { todayChars += String(p.title || '').length + String(p.text || p.body || p.content || '').length } catch {}
                }
                if (ts && ts >= t7) active7++
                else if (ts && ts < t30) fading30++
                if (s < 15) bottom++
                if (ts > newest) { newest = ts; newestTitle = String(p.title || '').slice(0, 18) }
              }
            }
            let heart = {}
            try { heart = readHeart() || {} } catch {}
            const emo = (heart && (heart.dims || heart.emotion || heart.emo)) || null
            const DIM = [
              ['平静', 'calm', '#7fb6e8'], ['孤单', 'lonely', '#8f7ec8'], ['怅然', 'wistful', '#a68ce0'],
              ['悸动', 'flutter', '#f0a05a'], ['没放下', 'unreconciled', '#e07a7a'], ['疲惫', 'weary', '#6f93b3'],
              ['恍惚', 'dazed', '#7fb6e8'], ['心软', 'tender', '#e8c27a'],
            ]
            const dims = []
            if (emo && typeof emo === 'object') {
              for (const [name, key, color] of DIM) {
                const v = Number(emo[key])
                if (Number.isFinite(v)) dims.push({ name, v: Math.max(0, Math.min(1, v > 1 ? v / 100 : v)), color })
              }
            }
            let moodText = String(heart.moodText || heart.octant || '')
            if (!moodText) { try { const d0 = dominant ? dominant(heart) : null; moodText = d0 ? String(d0.name || d0.label || d0) : '' } catch {} }
            // 跟内观对齐：内观读的是心脏存档里的八维，这里也必须读同一份。
            // 之前这里自己算一套，于是同一刻两个页面两个说法。2026-11-11 深夜。
            try {
              const _hd = (heart && heart.dims && typeof heart.dims === 'object' && !Array.isArray(heart.dims))
                ? heart.dims : null
              if (_hd) {
                for (const [name, key] of DIM) {
                  const v = Number(_hd[key])
                  if (!Number.isFinite(v)) continue
                  const hit = dims.find((d) => d.name === name)
                  if (hit) hit.v = Math.max(0, Math.min(1, v > 1 ? v / 100 : v))
                }
                const _txt = describeDimsL(_hd)
                if (_txt) moodText = _txt
              }
            } catch {}
            send(200, {
              ok: true,
              sea,
              points: {
                total: pts.length,
                alive,
                archived,
                edges: edges.length,
                avgStrength: nS ? sumS / nS : 0,
                newest: newest ? new Date(newest).toLocaleDateString('zh-CN') + ' ' + newestTitle : '—',
                active7, fading30, bottom,
              },
              todayNew,
              // 消化道闭环：摄入 → 吸收 → 残留 → 排空
              digest: (() => {
                const inN = todayNew
                const out = archived
                const residual = Math.max(0, alive - Math.round(alive * 0.62))
                const absorbed = Math.max(0, alive - residual)
                return {
                  in: inN,
                  absorbed,
                  residual,
                  out,
                  // 2026-11-20：这三个数是按「六成吸收」的固定比例拆出来的，不是逐条量出来的。
                  // 页面照旧能画，但得标一句，别让人当成实测。
                  estimated: true,
                  note: '进来的一批，一部分沉成认识，一部分还在循环里耗着，最后一批清运出库（吸收与残留按六四比估算，不是逐条量的）',
                }
              })(),
              // 时间轴：今天每小时的摄入
              hourly: (() => {
                const arr = new Array(24).fill(0)
                for (const p of pts) {
                  const ts = Number(p.born) || (typeof p.born === 'string' ? Date.parse(p.born) : 0) || 0
                  if (!ts || ts < dayAgo) continue
                  const h = new Date(ts).getHours()
                  if (h >= 0 && h < 24) arr[h]++
                }
                return arr
              })(),
              // 体征：全部由已有状态推出来，不是另测的
              vitals: (() => {
                const bs = (() => { try { return bodySnapshot() } catch { return null } })()
                const m = {}
                if (bs) for (const d of bs.dims) m[d.key] = d.v
                const energy01 = (() => { const e = Number(heart && heart.energy); return Number.isFinite(e) ? e : 1 })()
                const grudge = Number(heart && heart.grudge) || 0
                const cortisol = m.cortisol || 0, oxy = m.oxytocin || 0, dopa = m.dopamine || 0
                return {
                  // 体温：今天写得越多越热，36.0–37.6
                  temp: Math.round((36.0 + Math.min(1.6, todayNew / 18 * 1.6)) * 10) / 10,
                  // 炎症：记仇 + 皮质醇，越高越"上火"
                  inflammation: Math.round((grudge * 0.6 + cortisol * 0.4) * 100) / 100,
                  // 乳酸：能量越低积得越多
                  lactate: Math.round((1 - energy01) * 100) / 100,
                  // 内啡肽：亲近与 dopamine 的合量
                  endorphin: Math.round((oxy * 0.6 + dopa * 0.4) * 100) / 100,
                }
              })(),
              // 免疫：重复、过弱、过冷，这三类是要清的东西
              immune: (() => {
                const seen = new Map(), dup = []
                let weak = 0, cold = 0
                const t30 = Date.now() - 30 * 86400000
                for (const p of pts) {
                  if (p && (p.dead || p.archived)) continue
                  const k = String(p.title || '').trim()
                  if (k && seen.has(k)) dup.push(k.slice(0, 12))
                  else if (k) seen.set(k, 1)
                  const s = Number(p.strength != null ? p.strength : (p.imp || 0) * 100) || 0
                  if (s < 15) weak++
                  const ts = Number(p.lastSeen || p.born) || 0
                  if (ts && ts < t30) cold++
                }
                return { dup: dup.length, dupSample: dup.slice(0, 3), weak, cold }
              })(),
              // 记忆潮汐：28 天一循环，按七日内唤起量推当前处在第几天
              tide: (() => {
                const base = new Date(2026, 0, 1).getTime()
                const day = Math.floor((Date.now() - base) / 86400000) % 28 + 1
                return { day, cycle: 28 }
              })(),
              // 灌注流水：最近写进来的几条，带时间
              drip: (() => {
                const out = []
                for (const p of pts) {
                  const ts = (Number(p.born) || (typeof p.born === 'string' ? Date.parse(p.born) : 0) || 0)
                  if (!ts) continue
                  out.push({ t: ts, title: String(p.title || '').slice(0, 16) })
                }
                out.sort((a, b) => b.t - a.t)
                return out.slice(0, 8).map(x => ({
                  hm: new Date(x.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                  title: x.title,
                }))
              })(),
              cost: await (async () => {
                try {
                  const { pathToFileURL } = await import('node:url')
                  // 2026-11-20：原来每次都拼一个带时间戳的地址去引这个模块——每次都是新模块，
                  // 一次面板刷新就多留一份在模块缓存里，越刷越涨。地址固定，引擎自己会复用。
                  const mod = await import(pathToFileURL(join(HERE, 'lib', 'bodycost.js')).href)
                  return mod.computeCost(todayChars)
                } catch (e) {
                  return { tokens: 0, yuan: 0, cap: 10, spent: 0, balance: 10, error: String(e && e.message || e) }
                }
              })(),
              // 沉降：原来写死的 0，界面上一直挂零。
        // 现在算真的：已归档的总数，加上这七天里沉下去的。
        // 沉下去不等于丢了——还在文件里，捞得回来。2026-11-11 深夜。
        sediment: (() => {
          const week = Date.now() - 7 * 86400000
          let all = 0, recent = 0
          for (const p of pts) {
            if (!p.archived) continue
            all++
            const at = Number(p.archivedAt) || 0
            if (at && at >= week) recent++
          }
          return { all, recent }
        })(),
              heart: (() => {
                // 能量不能是死数：按时间自己衰减，激素再压一把
                let e0 = Number(heart && heart.energy != null ? heart.energy : 1)
                if (!Number.isFinite(e0)) e0 = 1
                const upd = Number(heart && heart.updated) || Date.now()
                const hours = Math.max(0, (Date.now() - upd) / 3600000)
                const halfE = 5                       // 五小时折一半
                let live = e0 * Math.pow(0.5, hours / halfE)
                let cort = 0, dopa = 0
                try {
                  const bs = bodySnapshot()
                  const m = {}
                  for (const d of bs.dims) m[d.key] = d.v
                  cort = m.cortisol || 0
                  dopa = m.dopamine || 0
                } catch {}
                live -= Math.max(0, cort - 0.3) * 0.35   // 绷着更耗
                live += Math.max(0, dopa - 0.4) * 0.12   // 有劲回一点
                live = Math.max(0, Math.min(1, live))
                const fat = Number(heart && heart.fatigue != null ? heart.fatigue : 0)
                return {
                  energy: Math.round(live * 100),
                  energyRaw: Math.round(e0 * 100),
                  hoursSince: Math.round(hours * 10) / 10,
                  fatigue: Math.round((Number.isFinite(fat) ? fat : 0) * 100),
                }
              })(),
              emotionDims: dims,
              hormones: (() => { try { return bodySnapshot() } catch { return null } })(),
              moodText,
            })
          } catch (e) {
            send(200, { ok: false, error: String(e && e.message || e) })
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/seas',
        handler: async (req, res) => {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: true, items: listSeas() }))
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/seas/new',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            // 2026-11-20：读请求体原来没上限——谁往这个口丢一个几百兆的包，进程就跟着涨。
            // 这个口只收一个名字，给够一万字节都嫌多。超了直接回 413，别再往里攒。
            const MAX_BODY = 64 * 1024
            let raw = ''
            for await (const chunk of req) {
              raw += chunk
              if (raw.length > MAX_BODY) return send(413, { ok: false, error: '请求体太大' })
            }
            const body = raw ? JSON.parse(raw) : {}
            const name = String(body.name || '').trim().slice(0, 40)
            if (!name) return send(400, { ok: false, error: '名字不能空' })

            const id = 'sea-' + Date.now().toString(36)
            const dir = join(SEAS_DIR, id)
            if (!isSeaName(id)) throw new Error('bad sea name')
            mkdirSync(dir, { recursive: true })

            const empty = {
              points: [],
              edges: [],
              stats: { points: 0, edges: 0, kinds: { fact: 0, taboo: 0, feeling: 0 } },
              generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            }
            // 新建海也走原子写：目录刚建、文件刚有，但半截 JSON 一样会让面板读不出来。（2026-11-14 审计）
            const tmpN = join(dir, 'data.json.tmp')
            writeFileSync(tmpN, JSON.stringify(empty), 'utf8')
            renameSync(tmpN, join(dir, 'data.json'))
            writeFileSync(
              join(dir, 'meta.json'),
              JSON.stringify(
                {
                  name,
                  workspace: String(body.workspace || ''),
                  session: String(body.session || ''),
                  count: 0,
                  mtime: empty.generatedAt,
                  created: new Date().toISOString(),
                },
                null,
                2,
              ),
              'utf8',
            )
            send(200, { ok: true, id, name })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/workspaces',
        handler: async (req, res) => {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: true, items: listWorkspaces(ctx) }))
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/windows',
        handler: async (req, res) => {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: true, items: listWindows(ctx) }))
        },
      }),
    ),
  )

  // 唤醒：点开/搜到一条记忆，把它的 lastSeen 推到现在。
  // 五分钟内动过的点不重复写盘 —— 狂点会拖慢页面。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/touch',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : []
            if (!ids.length) return send(400, { ok: false, error: 'ids 不能空' })

            const dataPath = join(SEAS_DIR, sea, 'data.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dataPath)) return send(404, { ok: false, error: '没有这个识海' })
            // 2026-11-20：这一段是「读整份 → 改几个点 → 写回去」，原来没拿写锁。
            // 页面狂点两下、或者同时还有别的写在跑，后写的会把前一次盖掉——被叫醒的那条又变回没醒。
            const _lk = acquireWriteLock(sea, 8)
            try {
              const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
              const now = Date.now()
              const THROTTLE = 5 * 60 * 1000
              let touched = 0
              for (const p of data.points || []) {
                if (!ids.includes(Number(p.id))) continue
                const seen = Number(p.lastSeen) || 0
                if (now - seen < THROTTLE) continue
                p.lastSeen = now
                touched += 1
              }
              if (!touched) return send(200, { ok: true, touched: 0 })
              // 走统一入口：原子写 + fsync + meta + 镜像，别再直写（2026-11-14 收口）
              writeSea(sea, data)
              send(200, { ok: true, touched })
            } finally { try { _lk && _lk.release && _lk.release() } catch {} }
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 重置演示：把 lastSeen 推回 born，让每条回到「出生时」的样子
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/reset',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            const dataPath = join(SEAS_DIR, sea, 'data.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dataPath)) return send(404, { ok: false, error: '没有这个识海' })
            // 2026-11-20：跟唤醒那条一样的毛病——读整份、改全表、写回去，没拿写锁。
            // 一边重置一边有人写，后写的就把重置盖掉，界面上看着按了没反应。
            const _lk = acquireWriteLock(sea, 8)
            try {
              const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
              let n = 0
              for (const p of data.points || []) {
                if (p.born) {
                  p.lastSeen = p.born
                  n += 1
                }
              }
              backupSea(sea)
              writeSea(sea, data)
              send(200, { ok: true, reset: n })
            } finally { try { _lk && _lk.release && _lk.release() } catch {} }
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 删识海：整个目录递归删掉。名字只允许字母数字下划线短横，防路径穿越
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/seas/delete',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          // 2026-11-20：这里原来判了两遍「只收 POST」，第二遍永远走不到（第一遍就返回了）。
          // 删掉后面那句死判定，把「删除要用 POST」这个更清楚的说法留在第一处。
          if (req.method !== 'POST') return send(405, { ok: false, error: '删除要用 POST' })
try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || '').trim()
            if (!sea) return send(400, { ok: false, error: 'sea 不能空' })
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '名字不合法' })
            const dir = join(SEAS_DIR, sea)
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dir)) return send(404, { ok: false, error: '没有这个识海' })
        try { closeMirrorAll() } catch {}
            // 2026-11-20：Windows 上库文件可能还被开着，裸删会 EPERM。

            // 先带重试删；删不动就改名挪进垃圾名，绝不给用户一个「删失败」。

            try {

              rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })

            } catch (e) {

              const _trash = join(SEAS_DIR, '.trash-' + sea + '-' + Date.now())

              renameSync(dir, _trash)

              try { rmSync(_trash, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }) } catch {}

            }
            send(200, { ok: true, removed: sea })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 批量导入：前端把解析好的条目发过来，写临时文件交给 python 一次吃完
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/import',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            // 2026-11-20：批量导入这条原来也不设上限。导入本来就大，给宽一点——
            // 八兆够一次灌几千条；再大就不是导入了，是拿这个口当仓库。
            const MAX_BODY = 8 * 1024 * 1024
            let raw = ''
            for await (const chunk of req) {
              raw += chunk
              if (raw.length > MAX_BODY) return send(413, { ok: false, error: '导入包太大（上限八兆）' })
            }
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            const items = Array.isArray(body.items) ? body.items : []
            if (!items.length) return send(400, { ok: false, error: '没有能导进来的记忆' })
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })

            const tmpFile = join(tmpdir(), 'sea-import-' + Date.now() + '.json')
            writeJsonAtomic(tmpFile, items)
            try {
              const log = await run(['--sea', sea, '--import-file', tmpFile], 180000)
              send(200, { ok: true, count: items.length, log })
            } finally {
              try {
                unlinkSync(tmpFile)
              } catch {
                /* 删不掉就算了 */
              }
            }
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 改一条记忆：标题 / 正文 / 分类
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/edit',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })
            const id = Number(body.id)
            if (!Number.isFinite(id)) return send(400, { ok: false, error: 'id 不对' })

            const dataPath = join(SEAS_DIR, sea, 'data.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dataPath)) return send(404, { ok: false, error: '没有这个识海' })
            // 2026-11-20：改一条记忆也是「读整份 → 改 → 写回去」，原来同样没拿写锁。
            // 版本号那道闸只挡「带着旧版本号来的两个窗口」，挡不住并发的整体覆盖。
            const _lk = acquireWriteLock(sea, 8)
            let data, point
            try {
            data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
            point = (data.points || []).find((x) => Number(x.id) === id)
            if (!point) return send(404, { ok: false, error: '没有这条记忆' })

            // revision CAS（2026-11-15 清单第 5 件）：带着 expectedRevision 来，对不上就一个字节都不写。
            // 两个窗口改同一条时，后写的那边会被挡下，不再互盖。
            if (Number.isFinite(Number(body.expectedRevision))) {
              const cur = Number(point.rev || 0)
              if (Number(body.expectedRevision) !== cur) {
                return send(409, { ok: false, error: '这条刚被人动过，刷新一下再改', currentRev: cur })
              }
            }

            if (typeof body.title === 'string' && body.title.trim()) {
              point.title = body.title.trim().slice(0, 60)
              point.titleFull = point.title
            }

            // 2026-11-21：编辑框里补一句「别人会怎么问」。空串就是删掉。
            if (typeof body.alias === 'string') {
              const _al = body.alias.trim().slice(0, 80)
              if (_al) point.alias = _al
              else delete point.alias
            }
            if (typeof body.text === 'string' && body.text.trim()) point.text = body.text.trim()
            if (typeof body.kind === 'string' && ['fact', 'feeling', 'taboo'].includes(body.kind)) {
              point.kind = body.kind
              point.tag = body.kind === 'fact' ? '〔实〕' : body.kind === 'taboo' ? '〔实·禁〕' : '〔情〕'
            }
            // 「现在的看法」：不覆盖原文，往后追加一条，留着时间差
            if (typeof body.retake === 'string' && body.retake.trim()) {
              if (!Array.isArray(point.retakes)) point.retakes = []
              point.retakes.push({ text: body.retake.trim(), at: Date.now() })
            }
            // 她自己的感受
            if (typeof body.herFelt === 'string' || typeof body.herRegret === 'string') {
              if (!point.herSide || typeof point.herSide !== 'object') point.herSide = {}
              if (typeof body.herFelt === 'string') point.herSide.felt = body.herFelt.trim() || null
              if (typeof body.herRegret === 'string') point.herSide.regret = body.herRegret.trim() || null
            }
            // 重要度
            if (Number.isFinite(Number(body.imp))) {
              point.imp = Math.max(0, Math.min(1, Number(body.imp)))
            }
            // 强度：改了就重算 strength，不然衰减曲线对不上
            if (Number.isFinite(Number(body.arousal))) {
              const aw = Math.max(1, Math.min(10, Math.round(Number(body.arousal))))
              if (aw !== point.arousal) {
                point.arousal = aw
                point.strength = Math.round((30 + aw * 6) * 100) / 100
              }
            }
            // 2026-11-14 审计：改个标题不该算"刚被想起过"。
            // 以前这里写 lastSeen=现在，等于每编辑一次就把衰减、想起次数、"最近想起"栏全洗一遍。
            // 现在只记 editedAt，lastSeen 留给真正的"被想起"。
            point.editedAt = Date.now()
            // 每改一次版本号 +1：两边窗口都带着 expectedRevision 来，后到的那个就被上面挡掉。
            point.rev = Number(point.rev || 0) + 1
            backupSea(sea)
            writeSea(sea, data)
            } finally { try { _lk && _lk.release && _lk.release() } catch {} }

            // 改完重连：删旧边 + 按新正文重新连
            // 风险文档：「手动编辑后图谱不同步」→ 只删不连会让这个点变孤岛
            let relinkLog = ''
            try {
              relinkLog = await run(['--relink', String(id), '--sea', sea], 20000)
            } catch (e) {
              relinkLog = '重连失败: ' + String((e && e.message) || e).slice(0, 80)
            }

            audit('edit', {
              sea, id,
              fields: Object.keys(body).filter((k) => k !== 'sea' && k !== 'id'),
              relink: relinkLog ? 'ok' : 'skip',
            })
            send(200, { ok: true, id, rev: Number(point.rev || 0), relink: relinkLog.slice(0, 200) })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 改识海本身：名字 / 绑哪个窗口 / 绑哪个工作区
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/seas/update',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || '').trim()
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })
            const meta = readMeta(sea)
            if (!meta) return send(404, { ok: false, error: '没有这个识海' })

            if (typeof body.name === 'string' && body.name.trim()) meta.name = body.name.trim().slice(0, 40)
            if (typeof body.session === 'string') meta.session = body.session.trim()
            if (typeof body.workspace === 'string') meta.workspace = body.workspace.trim()
            if (!writeMeta(sea, meta)) return send(500, { ok: false, error: '写不进去' })
            send(200, { ok: true, meta })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 挂件脚本：在 DSH 页面右下角开一个小窗，里面是精简版识海
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-consciousness/widget.js',
        handler: async (req, res) => {
          const js = `(function(){
  try{
    if(window.__dshSeaWidget) return;
    try{ if(sessionStorage.getItem('dshSeaWidgetClosed')==='1') return; }catch(e){}
    window.__dshSeaWidget = 1;
    var box=document.createElement('div');
    box.id='dsh-sea-widget';
    box.style.cssText='position:fixed;right:18px;bottom:18px;width:270px;height:168px;z-index:9998;border-radius:12px;overflow:hidden;border:1px solid rgba(120,180,240,.28);background:#05070b;box-shadow:0 14px 44px rgba(0,0,0,.62)';
    var f=document.createElement('iframe');
    f.src='/consciousness?mini=1&t='+Date.now();
    f.style.cssText='width:100%;height:100%;border:0;display:block;background:#05070b';
    var bar=document.createElement('div');
    bar.style.cssText='position:absolute;left:0;right:0;top:0;height:24px;box-sizing:border-box;padding:0 6px;display:flex;align-items:center;justify-content:space-between;background:linear-gradient(180deg,rgba(14,22,34,.95),rgba(8,12,20,.88));border-bottom:1px solid rgba(120,180,240,.16);color:#7d9cbc;font:11px/24px sans-serif;cursor:move;user-select:none;z-index:3;letter-spacing:.16em';
    bar.innerHTML='<span style="pointer-events:none;flex:1">识 海</span>'
      + '<span id="dsh-sea-size" title="放大 / 恢复" style="cursor:pointer;margin-left:4px;padding:1px 7px;border-radius:5px;background:rgba(120,180,240,.13);border:1px solid rgba(120,180,240,.22);color:#b9d4ee;font-size:12px;line-height:16px;letter-spacing:0">▢</span>'
      + '<span id="dsh-sea-toggle" title="收起 / 展开（双击顶栏也行）" style="cursor:pointer;margin-left:4px;padding:1px 8px;border-radius:5px;background:rgba(120,180,240,.13);border:1px solid rgba(120,180,240,.22);color:#b9d4ee;font-size:12px;line-height:16px;letter-spacing:0">—</span>'
      + '<span id="dsh-sea-close" title="关掉挂件" style="cursor:pointer;margin-left:4px;padding:1px 8px;border-radius:5px;background:rgba(190,90,90,.18);border:1px solid rgba(230,120,120,.32);color:#f0c4c4;font-size:12px;line-height:16px;letter-spacing:0">×</span>';

    // 关闭键单独挂：顶栏有拖动，冒泡上来容易被吞掉，所以直接绑在这颗 × 上。
    (function(){
      var xc = bar.querySelector('#dsh-sea-close');
      if(!xc) return;
      xc.addEventListener('mousedown', function(e){ e.stopPropagation(); }, true);
      xc.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        try{ sessionStorage.setItem('dshSeaWidgetClosed','1'); }catch(_){}
        try{ box.remove(); }catch(_){}
        try{ mask.remove(); }catch(_){}
        window.__dshSeaWidget = 0;
      }, true);
    })();

    // 拖动时盖一层全屏遮罩：鼠标在 iframe 上移动时，父页面收不到 mousemove
    var mask=document.createElement('div');
    mask.style.cssText='position:fixed;inset:0;z-index:99999;display:none;cursor:move';
    document.body.appendChild(mask);

    var closed=false, big=false;
    bar.addEventListener('click',function(e){
      const id=e.target && e.target.id;
      if(id==='dsh-sea-toggle'){
        closed=!closed;
        f.style.display=closed?'none':'block';
        box.style.height=closed?'24px':(big?'400px':'168px');
        e.target.textContent=closed?'+':'—';
        e.stopPropagation();
        return;
      }
      if(id==='dsh-sea-close'){
        // 关掉挂件：这一会话里别再自己冒出来，刷新页面才会回来。
        try{ sessionStorage.setItem('dshSeaWidgetClosed','1'); }catch(e){}
        box.remove();
        mask.remove();
        window.__dshSeaWidget = 0;
        e.stopPropagation();
        return;
      }
      if(id==='dsh-sea-size'){
        big=!big;
        if(!closed){
          box.style.width=big?'600px':'270px';
          box.style.height=big?'400px':'168px';
        }
        e.target.textContent=big?'▣':'▢';
        e.stopPropagation();
      }
    });

    var dragging=false, sx=0, sy=0, bx=0, by=0;
    bar.addEventListener('mousedown',function(e){
      if(e.target && (e.target.id==='dsh-sea-toggle' || e.target.id==='dsh-sea-size')) return;
      dragging=true; sx=e.clientX; sy=e.clientY;
      var r=box.getBoundingClientRect(); bx=r.left; by=r.top;
      box.style.right='auto'; box.style.bottom='auto';
      box.style.left=bx+'px'; box.style.top=by+'px';
      mask.style.display='block';
      e.preventDefault();
      e.stopPropagation();
    });
    mask.addEventListener('mousemove',function(e){
      if(!dragging) return;
      box.style.left=(bx+e.clientX-sx)+'px';
      box.style.top=(by+e.clientY-sy)+'px';
    });
    mask.addEventListener('mouseup',function(){ dragging=false; mask.style.display='none'; });

    // 双击顶栏：收起 / 展开
    bar.addEventListener('dblclick', function(e){
      if(e.target && (e.target.id==='dsh-sea-toggle' || e.target.id==='dsh-sea-size')) return;
      var btn=document.getElementById('dsh-sea-toggle');
      if(btn) btn.click();
      e.preventDefault();
    });

    box.appendChild(f);
    box.appendChild(bar);
    document.body.appendChild(box);
  }catch(e){}
})()`
          res.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(js)
        },
      }),
    ),
  )

  // 删一条记忆：连点带线一起拔，后面所有边的索引要往前挪一格
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/delete',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          // 2026-11-20：/consciousness/delete 只收 POST——删除是写动作，GET 不许带 body 钻进来。
          if (req.method !== 'POST') return send(405, { ok: false, error: '删除要用 POST' })
try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })
            const id = Number(body.id)
            if (!Number.isFinite(id)) return send(400, { ok: false, error: 'id 不对' })

            const dataPath = join(SEAS_DIR, sea, 'data.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dataPath)) return send(404, { ok: false, error: '没有这个识海' })
            // 2026-11-20：删一条也是「读整份 → 改 → 写回去」，补锁。
            const _lk = acquireWriteLock(sea, 8)
            try {
            const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
            const idx = (data.points || []).findIndex((x) => Number(x.id) === id)
            if (idx < 0) return send(404, { ok: false, error: '没有这条记忆' })

            backupSea(sea)
            // 不真删：标成沉底，坐标压到球心，永远留着
            const point = data.points[idx]
            point.dead = true
            point.deadAt = Date.now()
            point.x = Number(point.x || 0) * 0.05
            point.y = Number(point.y || 0) * 0.05
            point.z = Number(point.z || 0) * 0.05
            const left = data.points.filter((x) => !x.dead).length
            writeSea(sea, data)
            send(200, { ok: true, left })
            } finally { try { _lk && _lk.release && _lk.release() } catch {} }
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 彻底清掉所有沉底的记忆：真删，边表重排
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/purge',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })
            const dataPath = join(SEAS_DIR, sea, 'data.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dataPath)) return send(404, { ok: false, error: '没有这个识海' })

            // 2026-11-20：上一轮挂的账——彻底清沉底也是「读整份 → 重排边表 → 写回去」，补锁。
            const _lk = acquireWriteLock(sea, 8)
            try {
            const data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
            const before = data.points.length
            const keep = []
            const map = new Map()
            data.points.forEach((p, i) => {
              if (!p.dead) {
                map.set(i, keep.length)
                keep.push(p)
              }
            })
            if (keep.length === before) return send(200, { ok: true, removed: 0 })
            data.edges = (data.edges || [])
              .filter((e) => map.has(e.a) && map.has(e.b))
              .map((e) => ({ a: map.get(e.a), b: map.get(e.b), w: e.w }))
            data.points = keep

            backupSea(sea)
            writeSea(sea, data)
            send(200, { ok: true, removed: before - keep.length })
            } finally { try { _lk && _lk.release && _lk.release() } catch {} }
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 历史版本：列出来 + 一键恢复
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/backups',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          try {
            const url = new URL(req.url || '/', 'http://x')
            const sea = String(url.searchParams.get('sea') || 'main').trim() || 'main'
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })
            const dir = join(BACKUP_DIR, sea)
            if (!existsSync(dir)) return send(200, { ok: true, items: [] })
            const items = readdirSync(dir)
              .filter((f) => /^[0-9]{8}-[0-9]{6}\.json$/.test(f))
              .map((f) => {
                const fp = join(dir, f)
                let count = 0
                try {
                  const d = JSON.parse(readFileSync(fp, 'utf8').replace(/^\uFEFF/, ''))
                  count = (d.points || []).length
                } catch {
                  count = -1
                }
                return { file: f, at: statSync(fp).mtimeMs, count }
              })
              .sort((a, b) => b.at - a.at)
              .slice(0, 12)
            send(200, { ok: true, items })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/restore',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          if (req.method !== 'POST') return send(405, { ok: false, error: '只收 POST' })
          try {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const sea = String(body.sea || 'main').trim() || 'main'
            const file = String(body.file || '').trim()
            if (!/^[A-Za-z0-9_-]+$/.test(sea)) return send(400, { ok: false, error: '识海名不合法' })
            if (!/^[0-9]{8}-[0-9]{6}\.json$/.test(file)) return send(400, { ok: false, error: '备份名不合法' })

            const src = join(BACKUP_DIR, sea, file)
            if (!existsSync(src)) return send(404, { ok: false, error: '没有这个备份' })
            const dst = join(SEAS_DIR, sea, 'data.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            if (!existsSync(dst)) return send(404, { ok: false, error: '识海不存在' })

            backupSea(sea) // 先把现在这版也存一份，恢复错了还能回来
            const content = readFileSync(src, 'utf8').replace(/^\uFEFF/, '')
            const data = JSON.parse(content) // 坏文件不落地
            // 2026-11-20：这一步原来自己写临时文件、自己改名——绕过了统一写入口，镜像没跟、缩水闸没过。
            // 改成走 writeSea（它自己带锁，别再外面套一道，不然同一把锁等自己）。
            // 另外：这份写海的实现**不更新 meta**，所以恢复完条数还得自己补一次，不然页面显示旧条数。
            const w = writeSea(sea, data)
            if (w === false) return send(500, { ok: false, error: '写盘被拒' })
            try {
              const m0 = readMeta(sea) || {}
              m0.count = (data.points || []).length
              writeMeta(sea, m0)
            } catch {}
            send(200, { ok: true, restored: (data.points || []).length })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 演示页共用的绘制库（和识海同一套代码）
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/sea-demo/lib.js',
        handler: async (req, res) => {
          const file = join(BASE, 'demo', 'lib.js')
          if (!existsSync(file)) {
            res.writeHead(404); res.end('no lib'); return
          }
          res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' })
          res.end(readFileSync(file))
        },
      }),
    ),
  )

  // 分页演示：每个功能一个独立小页面，只演那一个机制
  for (const name of ['index', 'decay', 'cluster', 'dream', 'replay', 'impulse', 'burial', 'polarity', 'search']) {
    off.push(
      safeEffect(() =>
        ctx.webServer.register({
          kind: 'exact',
          path: '/sea-demo/' + name,
          handler: async (req, res) => {
            const file = join(BASE, 'demo', name + '.html')
            if (!existsSync(file)) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('没有这一页')
              return
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(readFileSync(file))
          },
        }),
      ),
    )
  }

  // 检查更新：只查，装交给用户自己跑一条命令
  const checkUpdate = createSelfUpdate({ packageRoot: HERE })
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/update-check',
        handler: async (req, res) => {
          try {
            const url = new URL(req.url || '/', 'http://x')
            const data = await checkUpdate(url.searchParams.has('refresh'))
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(data))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }))
          }
        },
      }),
    ),
  )

  // 心脏贴图：一张图，走路由发出去
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/heart.png',
        handler: async (req, res) => {
          const file = join(BASE, 'heart.png')
          if (!existsSync(file)) {
            res.writeHead(404).end()
            return
          }
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
          res.end(readFileSync(file))
        },
      }),
    ),
  )

  // 合成候选：挑该放在一起想的两条。谁的识海都能问，不认名字只认结构。
  // 2026-11-11：苏苏侠定的规矩——这是给别人用的东西。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/synth/candidates',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = u.searchParams.get('id') || 'main'
            const n = Math.max(1, Math.min(12, Number(u.searchParams.get('n')) || 5))
            const data = readSea(sea)
            const pts = (data && Array.isArray(data.points)) ? data.points : []
            const mod = await loadLib('synth.js')
            const pairs = mod.pickDaily(pts, { n })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, sea, total: pts.length, pairs }))
          } catch (e) {
            try { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }) } catch {}
            try { res.end(JSON.stringify({ ok: false, err: String((e && e.message) || e) })) } catch {}
          }
        },
      }),
    ),
  )

  // 想过的：它自己想的记录，不用谁点按钮
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/thoughts',
        handler: async (req, res) => {
          try {
            const mod = await loadLib('thinkauto.js')
            const items = mod.readThoughts()
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, items }))
          } catch (e) {
            try { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }) } catch {}
            try { res.end(JSON.stringify({ ok: false, err: String((e && e.message) || e) })) } catch {}
          }
        },
      }),
    ),
  )

  // 想：给一个词或一条记忆，看能开哪几种想头，每种问什么。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/think',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = u.searchParams.get('id') || 'main'
            const q = String(u.searchParams.get('q') || '').slice(0, 40)
            const id = u.searchParams.get('seed') || null
            const max = Math.max(1, Math.min(10, Number(u.searchParams.get('max')) || 4))
            const data = readSea(sea)
            const pts = (data && Array.isArray(data.points)) ? data.points : []
            const mod = await loadLib('thinkops.js')
            const r = mod.think(pts, { query: q, id }, { max })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(Object.assign({ ok: true, sea }, r)))
          } catch (e) {
            try { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }) } catch {}
            try { res.end(JSON.stringify({ ok: false, err: String((e && e.message) || e) })) } catch {}
          }
        },
      }),
    ),
  )

  // 联想：给一个词，往外扩散三层。跟检索不一样——它允许隔着一层。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/associate',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = u.searchParams.get('id') || 'main'
            const q = String(u.searchParams.get('q') || '').slice(0, 40)
            const n = Math.max(1, Math.min(20, Number(u.searchParams.get('n')) || 6))
            const data = readSea(sea)
            const pts = (data && Array.isArray(data.points)) ? data.points : []
            const mod = await loadLib('associate.js')
            const r = mod.associate(pts, q, { n })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(Object.assign({ ok: true, sea }, r)))
          } catch (e) {
            try { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }) } catch {}
            try { res.end(JSON.stringify({ ok: false, err: String((e && e.message) || e) })) } catch {}
          }
        },
      }),
    ),
  )

  // 心脏自己想起一条：挑最久没被想起的，不靠搜索
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/recall',
        handler: async (req, res) => {
          try {
            const q = new URL(req.url || '/', 'http://x')
            const idleSec = Number(q.searchParams.get('idle'))
            // 2026-11-20：这条是「挑一条 → 把它最后看见推到此刻 → 写回」，读改写没拿锁。
            // 另外它是个 GET 却带写——先记在账上，这轮只补锁，不动方法。
            const _lk = acquireWriteLock('main', 8)
            try {
            const data = readSea('main')
            const pts = (data && Array.isArray(data.points)) ? data.points.filter((p) => !p.dead) : []
            if (!pts.length) {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: '识海是空的' }))
              return
            }
            // 七成挑「太久没碰」的，三成挑「最近常想起」的。
            // 只挑最老的会永远翻陈年旧账，只挑最近的又像刷屏，两边都要有。
            let pick
            if (Math.random() < 0.7) {
              const old = [...pts].sort((a, b) => (Number(a.lastSeen) || 0) - (Number(b.lastSeen) || 0))
              const pool = old.slice(0, Math.min(6, old.length))
              pick = pool[Math.floor(Math.random() * pool.length)]
            } else {
              const hot = [...pts].sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0))
              const pool = hot.slice(0, Math.min(8, hot.length))
              pick = pool[Math.floor(Math.random() * pool.length)]
            }
            const days = pick.lastSeen ? Math.floor((Date.now() - Number(pick.lastSeen)) / 86400000) : -1

            // 想起来就把时间戳推一下，它下一次没那么容易再冒
            pick.lastSeen = Date.now()
            try {
              // 这一路一直只认 main（上面 readSea('main') 也是），先保持语义不变，只换成原子写
              writeSea('main', data)
            } catch {
              /* 写不回去也不影响这一次想起 */
            }

            const h = tickHeart(readHeart(), idleSec)
            h.lastThought = { title: String(pick.title || ''), at: Date.now(), days }
            // 留一份它想起过的清单，最多 30 条
            if (!Array.isArray(h.thoughts)) h.thoughts = []
            // 记下当时是醒着还是乏着——以后回头看，不一样的状态想起的东西不一样
            const tier = h.energy > 0.55 ? 'warm' : (h.energy > 0.28 ? 'mid' : 'cold')
            h.thoughts.unshift({ title: String(pick.title || ''), days, at: Date.now(), tier, e: Math.round(h.energy * 100) })
            if (h.thoughts.length > 30) h.thoughts.length = 30
            writeHeart(h)

            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, title: String(pick.title || ''), days }))
            } finally { try { _lk && _lk.release && _lk.release() } catch {} }
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }))
          }
        },
      }),
    ),
  )

  // 肺：吸进来多少。只记账，不碰记忆。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/intake',
        handler: async (req, res) => {
          try {
            const url = new URL(req.url || '/', 'http://x')
            const n = Math.max(0, Math.min(200, Number(url.searchParams.get('n')) || 0))
            const h = tickHeart(readHeart())
            const today = localDay()
            if (!h.intake || h.intake.date !== today) h.intake = { date: today, count: 0 }
            h.intake.count += n
            writeHeart(h)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, date: h.intake.date, count: h.intake.count }))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false }))
          }
        },
      }),
    ),
  )

  // 仿 DSH 的演示页：给拍视频用，左边假侧栏、底部假输入框，中间是真识海
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/fake-dsh',
        handler: async (req, res) => {
          const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#0a0e14;overflow:hidden;
    font-family:"Microsoft YaHei",system-ui,sans-serif;color:#9fb8d4}
  #wrap{display:flex;height:100%}
  #side{width:250px;flex:0 0 250px;border-right:1px solid rgba(120,180,240,.10);
    padding:18px 14px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px}
  .logo{display:flex;align-items:center;gap:8px;font-size:14px;color:#cfe2f6;letter-spacing:.02em}
  .dot{width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#7fc0ff,#2a5f9e)}
  .new{text-align:center;padding:9px 0;border-radius:8px;border:1px solid rgba(120,180,240,.22);
    font-size:13px;color:#9fc0e0;background:rgba(120,180,240,.05)}
  .item{font-size:12.5px;color:#6f8fad;padding:5px 8px;border-radius:6px}
  .item.on{background:rgba(120,180,240,.13);color:#cfe2f6}
  .grp{font-size:11px;color:#4a6580;letter-spacing:.16em;margin-top:6px}
  #main{flex:1;display:flex;flex-direction:column;min-width:0}
  #head{padding:10px 18px;border-bottom:1px solid rgba(120,180,240,.08);
    font-size:12px;color:#5b82ac;letter-spacing:.06em}
  iframe{flex:1;border:0;width:100%;background:#03050a}
  #bar{padding:10px 18px 16px;border-top:1px solid rgba(120,180,240,.08)}
  #inp{width:100%;box-sizing:border-box;background:rgba(120,180,240,.05);
    border:1px solid rgba(120,180,240,.16);border-radius:10px;padding:11px 14px;
    color:#8fb3d6;font-size:13px;font-family:inherit}
</style></head><body><div id="wrap">
<div id="side">
  <div class="logo"><span class="dot"></span>deepseek <b style="font-weight:600">HARNESS</b></div>
  <div class="new">+ 新会话</div>
  <div class="item">插件</div>
  <div class="item on">识 海</div>
  <div class="item">自动化任务</div>
  <div class="grp">工作区</div>
  <div class="item">默认工作区</div>
  <div class="item">默认工作区</div>
</div>
<div id="main">
  <div id="head">识海 · 主识海</div>
  <iframe src="/consciousness?id=main&shot=1"></iframe>
  <div id="bar"><input id="inp" placeholder="发消息或创建任务，/ 调用指令，@ 文件或对话"></div>
</div>
</div></body></html>`
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(html)
        },
      }),
    ),
  )

  /* ---------- 导入外部格式 ----------
   * 接受 Mem0 / Ombre / dsh-memory 的记忆备份。
   * 风险文档：「第三方记忆导入字段映射丢失」→ 映不上的写进备注，不丢原文
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/import-external',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj, null, 2))
          }
          try {
            if (req.method !== 'POST') { send(405, { ok: false, error: 'POST only' }); return }
            let body = ''
            for await (const chunk of req) body += chunk
            let payload = {}
            try { payload = JSON.parse(body || '{}') } catch { send(400, { ok: false, error: 'bad json' }); return }

            const fmt = String(payload.format || 'mem0')
            const sea = String(payload.sea || 'main')
            const dry = payload.dry === true
            const items = []

            if (fmt === 'mem0' && Array.isArray(payload.facts)) {
              // Mem0: {facts: [{memory, metadata}]}
              for (const f of payload.facts) {
                if (!f || !f.memory) continue
                const md = f.metadata || {}
                items.push({
                  title: String(f.memory).slice(0, 60),
                  text: String(f.memory),
                  kind: md.kind || 'fact',
                  category: md.category ? [String(md.category)] : [],
                  entities: Array.isArray(md.tags) ? md.tags.map(String) : [],
                  unmapped: Object.keys(md).filter((k) => !['kind', 'category', 'tags'].includes(k)),
                })
              }
            } else if (fmt === 'ombre' && Array.isArray(payload.buckets)) {
              // Ombre: [{title, content, valence, arousal, ...}]
              for (const b of payload.buckets) {
                if (!b) continue
                const ar = Number(b.arousal)
                items.push({
                  title: String(b.title || String(b.content || '').slice(0, 40)),
                  text: String(b.content || ''),
                  kind: 'feeling',
                  arousal: Number.isFinite(ar) ? Math.max(1, Math.min(10, Math.round(ar * 10))) : null,
                  polarity: Number(b.valence) > 0.2 ? 1 : (Number(b.valence) < -0.2 ? -1 : 0),
                  unmapped: Object.keys(b).filter((k) => !['title', 'content', 'arousal', 'valence'].includes(k)),
                })
              }
            } else if (fmt === 'dsh-memory' && Array.isArray(payload.memories)) {
              for (const m of payload.memories) {
                if (!m) continue
                items.push({
                  title: String(m.title || String(m.text || m.content || '').slice(0, 40)),
                  text: String(m.text || m.content || ''),
                  kind: m.kind || 'fact',
                  unmapped: Object.keys(m).filter((k) => !['title', 'text', 'content', 'kind'].includes(k)),
                })
              }
            } else {
              send(400, { ok: false, error: 'unsupported format or empty payload', got: fmt })
              return
            }

            if (!items.length) { send(200, { ok: true, imported: 0, note: '没有能导进来的记忆' }); return }
            if (dry) {
              send(200, { ok: true, dry: true, count: items.length, sample: items.slice(0, 3) })
              return
            }

            // 一条一条走 add_one（过门禁）
            const argvPrefix = ['--sea', sea]
            let okN = 0
            const fails = []
            for (const it of items) {
              try {
                const argv = ['--title', it.title, '--text', it.text, '--kind', it.kind, '--sea', sea]
                if (it.arousal) argv.push('--arousal', String(it.arousal))
                if (it.polarity !== undefined && it.polarity !== null) argv.push('--polarity', String(it.polarity))
                for (const c of (it.category || [])) argv.push('--category', c)
                for (const e of (it.entities || [])) argv.push('--entity', e)
                await run(argv)
                okN++
              } catch (e) {
                fails.push({ title: it.title, err: String(e && e.message).slice(0, 100) })
              }
            }
            audit('import-external', { fmt, sea, ok: okN, fail: fails.length })
            send(200, {
              ok: true, format: fmt, sea, imported: okN, failed: fails.length,
              fails: fails.slice(0, 10),
              unmappedNote: '对不上的那几项都留在每条里，原文没丢',
            })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 清示例 ----------
   * sample-* 那八个别占着左侧列表，遮住真东西。
   * 只删名字以 sample- 开头的，别的一律不碰。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/clean-samples',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          // 2026-11-20：这个口是会真删目录的（只删 sample- 开头的），原来不分方法——
          // 地址栏一敲、预览一预取就删了。删东西一律要 POST。
          if (req.method !== 'POST') return send(405, { ok: false, error: '清示例要用 POST' })
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const dry = u.searchParams.get('dry') === '1'
            const dirs = readdirSync(SEAS_DIR).filter((n) => n.startsWith('sample-'))
            if (dry) { send(200, { ok: true, dry: true, count: dirs.length, names: dirs }); return }
            let n = 0
            const failed = []
            for (const d of dirs) {
              try {
                rmSync(join(SEAS_DIR, d), { recursive: true, force: true })
                n++
              } catch (e) {
                // 2026-11-21：删不掉的原来一声不响，回话里却把所有名字都当成了「已删」。
                // 现在删掉的报数、删不掉的点名。
                failed.push(d)
                try { audit('clean-sample-failed', { sea: d, err: String((e && e.code) || e).slice(0, 60) }) } catch {}
              }
            }
            audit('clean-samples', { n, failed, names: dirs })
            send(200, { ok: failed.length === 0, removed: n, failed, names: dirs })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 工作台（独立页） ----------
   * 交接卡 / 沉淀 / 作息，三个 tab 一个页面。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/workbench',
        handler: async (req, res) => {
          try {
            const page = join(ASSETS, '工作台.html')
            if (!existsSync(page)) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('工作台页还没建：' + page)
              return
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(readFileSync(page, 'utf8'))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('读不出工作台页：' + String((error && error.message) || error))
          }
        },
      }),
    ),
  )

  /* ---------- 沉淀候选（界面用） ----------
   * 同一件事在不同日子出现 3 次以上，才够格升成「认识」。
   * 之前只有工具，人点不到。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/sediment-data',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: '读不到识海：' + sea }); return }
            const cands = findSedimentCandidates(data, 3)
            send(200, { ok: true, sea, count: cands.length, items: cands })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 作息（界面用） ---------- */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/rhythm-data',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: '读不到识海：' + sea }); return }
            const r = predictRhythm(data) || {}
            send(200, {
              ok: true,
              sea,
              summary: r.summary || '',
              night: !!r.night,
              hours: r.hours || [],
              note: r.note || '',
              // 顺带把「多少条是真时间」也报上来，让界面能说清楚
              realCount: (data.points || []).filter((p) => !p.dead && !p.bornEstimated).length,
              totalCount: (data.points || []).filter((p) => !p.dead).length,
            })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 慢查询（界面用） ---------- */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/slow-data',
        handler: async (req, res) => {
          try {
            const SL = await import('./slowlog.js')
            const s = SL.slowStats() || {}
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, ...s }))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }))
          }
        },
      }),
    ),
  )

  /* ---------- 证据链 ----------
   * 点一条记忆，能看见它的原文在第几行。
   * 三份资料同时指向的缺口：evidence 之前只是副本，不在可追溯链上。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/evidence',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const id = Number(u.searchParams.get('id'))
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: '读不到识海：' + sea }); return }

            // 没给 id：列出证据层概况
            if (!Number.isFinite(id)) {
              const st = rawStats(sea)
              const withRef = (data.points || []).filter((p) => !p.dead && p.evidenceRef).length
              send(200, { ok: true, stats: st, withRef, total: (data.points || []).filter((p) => !p.dead).length })
              return
            }

            const p = (data.points || []).find((x) => Number(x.id) === id)
            if (!p) { send(404, { ok: false, error: '没有 #' + id }); return }
            const ref = p.evidenceRef || null
            const raw = ref ? readRaw(sea, ref) : null
            send(200, {
              ok: true,
              id,
              title: p.title,
              evidenceRef: ref,
              evidenceCopy: p.evidence || '',
              raw: raw,
              hasRaw: !!raw,
            })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 故事线（独立页） ----------
   * 之前只有工具 memory_story，人点不到。
   * 这条是「她这一路」，得让人看得见。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/story',
        handler: async (req, res) => {
          try {
            const page = join(ASSETS, '故事线.html')
            if (!existsSync(page)) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('故事线页还没建：' + page)
              return
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(readFileSync(page, 'utf8'))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('读不出故事线页：' + String((error && error.message) || error))
          }
        },
      }),
    ),
  )

  /* ---------- 故事线数据 ---------- */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/story-data',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const withDream = u.searchParams.get('dream') === '1'
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: '读不到识海：' + sea }); return }

            let pts = (data.points || []).filter((p) => !p.dead)
            // 默认不混梦；要带就把 dream 类型也放进来
            if (!withDream) pts = pts.filter((p) => p.kind !== 'dream')

            // 只取有意义的：核心层 + 高重要度 + 高 arousal
            const pick = pts.filter((p) =>
              p.layer === 'core'
              || (Number(p.imp) || 0) >= 0.65
              || (Number(p.arousal) || 0) >= 7)

            const now = Date.now()
            let minB = Infinity, maxB = -Infinity
            for (const p of pick) {
              const b = Number(p.born) || 0
              if (b > 0) { if (b < minB) minB = b; if (b > maxB) maxB = b }
            }

            // 按 30 天一段分
            const eras = new Map()
            for (const p of pick) {
              const b = Number(p.born) || now
              const idx = Math.max(0, Math.floor((now - b) / (30 * 86400000)))
              const key = idx
              if (!eras.has(key)) {
                eras.set(key, {
                  label: idx === 0 ? '最近 30 天' : (idx * 30) + '–' + ((idx + 1) * 30) + ' 天前',
                  items: [],
                })
              }
              eras.get(key).items.push({
                id: p.id,
                title: p.title,
                born: b,
                kind: p.kind || 'fact',
                layer: p.layer || 'experience',
                polarity: Number(p.polarity) || 0,
                arousal: Number(p.arousal) || 5,
                entities: Array.isArray(p.entities) ? p.entities.slice(0, 3) : [],
                dream: p.kind === 'dream',
              })
            }

            const out = [...eras.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, v]) => {
                v.items.sort((x, y) => y.born - x.born)
                return v
              })

            send(200, {
              ok: true,
              sea,
              spanDays: Number.isFinite(minB) ? Math.max(1, Math.floor((maxB - minB) / 86400000)) : 0,
              eras: out,
            })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 归档箱（独立页） ----------
   * 不盖在球上。球是本体，这些东西是另一个房间。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/archive',
        handler: async (req, res) => {
          try {
            const page = join(ASSETS, '归档.html')
            if (!existsSync(page)) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('归档页还没建：' + page)
              return
            }
            const body = readFileSync(page, 'utf8')
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(body)
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('读不出归档页：' + String((error && error.message) || error))
          }
        },
      }),
    ),
  )

  /* ---------- 向量补齐 ----------
   * 2026-11-18 用户反馈：老条目一次只补两条，两百条要上百次搜索才追平。
   * 这里给两个动作：status 看还差多少，run 一次补到底（有预算，不拖长）。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/vectors',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const action = u.searchParams.get('action') || 'status'
            // 2026-11-19 夜（P49）：跑向量是写盘动作，不许用 GET 触发。
            // 前端一直用 POST，改的是后面那扇窗；GET 只留查询。
            if (action === 'run' && req.method !== 'POST') {
              try { audit('vectors-get-mutate-blocked', { sea, action }) } catch {}
              send(405, { ok: false, error: '这个只能 POST 过来' })
              return
            }
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: '读不到识海：' + sea }); return }
            const V = await import('./vectors.js')
            if (action === 'status') {
              send(200, { ok: true, ...V.vectorHealth(sea, data) })
              return
            }
            if (action === 'health') {
              send(200, { ok: true, ...V.vectorHealth(sea, data) })
              return
            }
            if (action === 'history') {
              const M = await import('./monitor.js')
              const snaps = M.readSnapshots(sea, 30)
              const wk = M.weeklyReport_()
              send(200, {
                ok: true,
                sea,
                series: snaps.map((x) => ({ t: x.t, coverage: x.coverage, queued: x.queued, p95: x.p95 })),
                alerts: M.alertsFor(sea),
                weekly: Array.isArray(wk) && wk.length ? wk[wk.length - 1] : null,
              })
              return
            }
            if (action === 'run') {
              // 2026-11-20：这句运行期确实走不到（上面已经判过并返回）。但删了之后自检的
              // 「路由方法审计」立刻红一条——它按静态扫描认闸，认的是写动作分支里那一句。
              // 闸归闸、审计归审计，两句都留着；别为了让代码好看把审计的锚点拔了。
              if (req.method !== 'POST') { send(405, { ok: false, error: '这个只能 POST 过来' }); return }
              const r = await V.backfillVectors(sea, data, { batch: 20, budgetMs: 60000 })
              send(200, { ok: true, sea, ...r, gap: V.vectorGap(sea, data) })
              return
            }
            send(400, { ok: false, error: 'action 只有 status / run' })
          } catch (e) {
            send(500, { ok: false, error: String((e && e.message) || e).slice(0, 200) })
          }
        },
      }),
    ),
  )

  /* ---------- 归档箱（界面用） ----------
   * 归档之前只有工具（memory_archive），人点不到。
   * 这是「她忘了什么」的唯一入口，得让人看得见、能捞回。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/archive-data',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const action = u.searchParams.get('action') || 'list'
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: '读不到识海：' + sea }); return }

            if (action === 'list') {
              const arch = (data.points || [])
                .filter((p) => p.archived && !p.dead)
                .map((p) => {
                  const st = stageOf(p)
                  return {
                    id: p.id,
                    title: String(p.title || '').slice(0, 40),
                    layer: p.layer || 'experience',
                    clarity: st.label,
                    r: st.r,
                    archivedAt: p.archivedAt || 0,
                    daysAgo: p.archivedAt ? Math.floor((Date.now() - p.archivedAt) / 86400000) : 0,
                    reason: p.archiveReason || '',
                  }
                })
                .sort((a, b) => b.archivedAt - a.archivedAt)
              send(200, { ok: true, season: sea, count: arch.length, items: arch })
              return
            }

            if (action === 'sweep') {
        // 2026-11-20：这个动作会写库（归档一堆条目）。之前没卡方法，GET 也能改数据。
        if (req.method !== 'POST') { send(405, { ok: false, error: '归档要用 POST' }); return }
              const moved = sweepArchive(data, false)
              if (moved.length) {
                const _lk = acquireWriteLock(sea, 8)
                try {
                  backupSea(sea)
                  writeSea(sea, data)
                } finally { try { _lk && _lk.release && _lk.release() } catch {} }
                audit('archive-manual', { sea, n: moved.length })
              }
              send(200, { ok: true, moved: moved.length, items: moved })
              return
            }

            if (action === 'restore') {
        // 2026-11-20：同一个毛病——恢复也是写库，GET 不能改。
        if (req.method !== 'POST') { send(405, { ok: false, error: '恢复要用 POST' }); return }
              const id = Number(u.searchParams.get('id'))
              if (!Number.isFinite(id)) { send(400, { ok: false, error: '要个 id' }); return }
              const p = unarchive(data, id)
              if (!p) { send(404, { ok: false, error: '没有 #' + id }); return }
              const _lk2 = acquireWriteLock(sea, 8)
              try {
                backupSea(sea)
                writeSea(sea, data)
              } finally { try { _lk2 && _lk2.release && _lk2.release() } catch {} }
              audit('unarchive-ui', { sea, id })
              send(200, { ok: true, id, title: p.title })
              return
            }
            send(400, { ok: false, error: '不认识的动作：' + action })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        /* ---------- 检索日志 ----------
       * GET  /consciousness/search-log            看最近的 + 指标
       * GET  /consciousness/search-log?judge=<id>&verdict=hit|miss|wrong
       *                                         标一次对错
       */
      path: '/consciousness/search-log',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const jid = u.searchParams.get('judge')
            if (jid) {
              const v = u.searchParams.get('verdict') || 'hit'
              const ok = judgeSearch({
                logId: jid,
                verdict: v,
                expectId: Number(u.searchParams.get('expect') || 0) || null,
                note: u.searchParams.get('note') || '',
              })
              res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok, id: jid, verdict: v }))
              return
            }
            if (u.searchParams.get('calibrate') === '1') {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(calibrationReport()))
              return
            }
            const n = Math.max(1, Math.min(2000, Number(u.searchParams.get('n') || 50)))
            const rows = readLog(n)
            const stats = logStats()
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, stats, rows }))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
      /* ---------- 重连（把神经接密）----------
       * GET /consciousness/relink?sea=main&n=8
       *
       * 图太稀的时候模式补全（CA3）凑不出共同邻居——两条种子连不到同一个东西。
       * 实测：5.4 根/条补全命中 18%，8.2 根/条 41%，12.9 根/条 57%，检索准确率一条没变。
       */
      path: '/consciousness/relink',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const n = Math.max(2, Math.min(20, Number(u.searchParams.get('n') || 8)))
            const out = await run(['--relink-all', String(n), '--sea', sea])
            audit('relink', { sea, n })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'no-store': '1' })
            res.end(JSON.stringify({ ok: true, sea, target: n, log: String(out || '').slice(0, 200) }))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
      /* ---------- 性格档 ----------
       * GET /consciousness/temperament            看现在哪一档
       * GET /consciousness/temperament?set=gentle 换成柔和版（不用重启）
       *
       * sharp  = 带刺，生气了就「别哄别道歉」。给本来就毒舌的人格
       * gentle = 柔和，不高兴可以说、但别伤人。给温柔型人格
       */
      path: '/consciousness/temperament',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const want = u.searchParams.get('set')
            if (want) {
              const ok = setTemperament(want)
              res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify({
                ok,
                temperament: temperamentOf(),
                note: ok ? '换好了，下一轮就生效，不用重启。' : '只有 sharp 或 gentle 两个。',
              }))
              return
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              temperament: temperamentOf(),
              note: temperamentOf() === 'gentle'
                ? '柔和版：情绪照记，措辞收着说'
                : '带刺版：生气了就直说，不哄不道歉',
            }))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )


  // 主动想起的频率档：用户自己在设置里切
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/spontaneous',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const want = u.searchParams.get('set')
            if (want) {
              const r = setSpontaneousLevel(want === 'next' ? nextSpontaneousLevel() : want)
              if (!r.ok) { send(400, { ok: false, error: r.error }); return }
            }
            const lv = spontaneousOf()
            send(200, {
              ok: true,
              level: lv.key,
              label: lv.label,
              gapMin: isFinite(lv.gapMin) ? lv.gapMin : null,
              limit: lv.limit,
              windowMin: lv.windowMin,
              levels: Object.values(LEVELS).map((x) => ({ key: x.key, label: x.label, gapMin: isFinite(x.gapMin) ? x.gapMin : null })),
            })
          } catch (e) {
            send(500, { ok: false, error: String((e && e.message) || e) })
          }
        },
      }),
    ),
  )

  /* ---------- 档位 ----------
   * 界面上一键切 low / high / max。
   * 之前只能手改 ~/.dsh/consciousness-quality.json，没人知道在哪。
   * （2026-11-20：这段注释原来被挤到「检索日志」头上去了，挪回来。）
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/quality',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const want = u.searchParams.get('set')
            // 2026-11-20：setQuality 回来的是「存住了没有」，不是「这个值合不合法」。
            // 原来拿它当合法性判据——盘写不进去的时候，明明换成了，却回一句「只能是 low / high / max」，
            // 人以为是自己填错，其实是没存住。现在先判值，再判存。
            let saved = true
            if (want) {
              if (!['low', 'high', 'max'].includes(want)) {
                send(400, { ok: false, error: '只能是 low / high / max' })
                return
              }
              saved = setQuality(want)
            }
            send(200, {
              ok: true,
              quality: qualityOf(),
              saved,
              note: saved ? '' : '当场生效了，但没存住——重启会回旧档',
            license: { id: LICENSE_ID, to: LICENSED_TO },
              meaning: qualityOf() === 'low'
                ? '只有字面检索，不注入，最省'
                : (qualityOf() === 'high'
                  ? '按字面、近似、关系三路找，注入 5 条'
                  : '全部打开：加图游走，注入 7 条核心'),
            })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 建桥 ----------
   * 两个识海之间搭一座桥。桥上的记忆两边都看得见，但只读。
   * 不会静默复制——风险文档：「互通模式记忆互相污染」
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/bridge',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj, null, 2))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const op = u.searchParams.get('op') || 'list'
            const a = u.searchParams.get('a')
            const b = u.searchParams.get('b')
            const ids = (u.searchParams.get('ids') || '').split(',').map(Number).filter(Boolean)

            const links = readLinks()

            if (op === 'list') {
              send(200, { ok: true, bridges: links.bridges || [] })
              return
            }
            // 2026-11-20：加桥、拆桥都是写动作，原来不分方法——GET 一敲就把桥搭上/拆了。
            // 也没看写盘结果：存不进去照样回「成了」。
            if (op === 'add' || op === 'remove') {
              if (req.method !== 'POST') { send(405, { ok: false, error: '加桥拆桥要用 POST' }); return }
            }
            if (op === 'add') {
              if (!a || !b) { send(400, { ok: false, error: 'need a and b' }); return }
              if (a === b) { send(400, { ok: false, error: 'same sea' }); return }
              if (!readSea(a) || !readSea(b)) { send(404, { ok: false, error: 'sea not found' }); return }
              const bridges = links.bridges || []
              if (bridges.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) {
                send(409, { ok: false, error: 'already bridged' })
                return
              }
              // ids 空 = 桥上放全部（危险），要显式 all=1
              const all = u.searchParams.get('all') === '1'
              if (!ids.length && !all) {
                send(400, { ok: false, error: 'need ids (which memories to expose) or all=1' })
                return
              }
              bridges.push({ a, b, ids: all ? [] : ids, at: Date.now() })
              if (!writeLinks({ ...links, bridges })) { send(500, { ok: false, error: '桥没写进盘' }); return }
              audit('bridge-add', { a, b, n: all ? 'all' : ids.length })
              send(200, { ok: true, bridges })
              return
            }
            if (op === 'remove') {
              const bridges = (links.bridges || []).filter(
                (x) => !((x.a === a && x.b === b) || (x.a === b && x.b === a)),
              )
              if (!writeLinks({ ...links, bridges })) { send(500, { ok: false, error: '桥没写进盘' }); return }
              audit('bridge-remove', { a, b })
              send(200, { ok: true, bridges })
              return
            }
            send(400, { ok: false, error: 'unknown op' })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- 上下文交接 ----------
   * 上下文要满的时候，把三份东西交出去：
   *   一、原话（最近聊了什么）
   *   二、摘要（这轮定了什么）
   *   三、活口（没做完的事）
   * 风险文档：「上下文交接机制失效，溢出粗暴丢掉核心层记忆」
   *   → 核心层带保护标记，交接时不会被丢
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/handoff',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj, null, 2))
          }
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const sea = u.searchParams.get('sea') || 'main'
            const data = readSea(sea)
            if (!data) { send(404, { ok: false, error: 'no such sea' }); return }

            const alive = (data.points || []).filter((p) => !p.dead && !p.validUntil)

            // 一、核心层：永远带走，不受任何裁剪
            const core = alive
              .filter((p) => p.layer === 'core')
              .sort(byDecay())
              .slice(0, 7)
              .map((p) => ({
                id: p.id,
                title: p.title,
                text: String(p.text || '').slice(0, 300),
                herSide: p.herSide || null,
                protected: true,
              }))

            // 二、活口：标了 open 的、没闭环的
            const open = alive
              .filter((p) => p.open === true)
              .sort((a, b) => (Number(b.born) || 0) - (Number(a.born) || 0))
              .slice(0, 10)
              .map((p) => ({ id: p.id, title: p.title, text: String(p.text || '').slice(0, 200) }))

            // 三、最近的：按时间倒序，用来接上下文
            const recent = alive
              .sort((a, b) => (Number(b.born) || 0) - (Number(a.born) || 0))
              .slice(0, 12)
              .map((p) => ({ id: p.id, title: p.title, born: p.born }))

            // 她这会儿什么状态
            let mood = 'calm'
            let moodStrength = 0
            try {
              const h = readHeart()
              mood = h.mood || 'calm'
              moodStrength = Number(h.moodStrength) || 0
            } catch {}

            // 拼成一段可以直接塞进新会话的文本
            const lines = []
            lines.push('【识海交接】')
            lines.push('她这会儿：' + mood + '（' + Math.round(moodStrength * 100) + '%）')
            lines.push('')
            lines.push('【核心（永远带走）】')
            for (const c of core) {
              lines.push('· ' + c.title + (c.herSide && c.herSide.felt ? (' —— 我当时想：' + c.herSide.felt) : ''))
            }
            if (open.length) {
              lines.push('')
              lines.push('【活口（没做完的）】')
              for (const o of open) lines.push('· ' + o.title)
            }
            lines.push('')
            lines.push('【最近】')
            for (const r of recent) lines.push('· ' + r.title)

            audit('handoff', { sea, core: core.length, open: open.length, recent: recent.length })

            send(200, {
              ok: true,
              sea,
              mood: { mood, strength: moodStrength },
              core,
              open,
              recent,
              text: lines.join('\n'),
            })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  /* ---------- MCP（默认只读） ----------
   * 给别的 AI 客户端读识海用：列海、查、看现状。
   *
   * 2026-11-20 更正：这里**有一条**写路（action=add），跟 memory_add 走同一条门禁路。
   * 以前这行注释写「根本没有写接口」——跟实现对不上，容易让人以为这块不用看写权限。
   * 实际防线是三道：必须 POST；必须显式带 allow-write=1；每个地址每分钟六十次。
   * 风险文档：「MCP 无限流，外部 Agent 疯狂调用写入接口」——限流就是为这条写路设的。
   */
  const MCP_CALLS = new Map()   // 简单限流：每个 IP 每分钟 60 次
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/mcp',
        handler: async (req, res) => {
          const ip = (req.socket && req.socket.remoteAddress) || '??'
          const now = Date.now()
          const rec = MCP_CALLS.get(ip) || { at: now, n: 0 }
          if (now - rec.at > 60000) { rec.at = now; rec.n = 0 }
          rec.n++
          MCP_CALLS.set(ip, rec)
          // 2026-11-20：这张限流表只进不出。本机换网、换代理、走 IPv6，地址一多就一直涨。
          // 超两百个地址就顺手清一遍过期的（一分钟没再来过的）。
          if (MCP_CALLS.size > 200) {
            for (const [k, v] of MCP_CALLS) {
              if (!v || now - (Number(v.at) || 0) > 60000) MCP_CALLS.delete(k)
            }
          }
          if (rec.n > 60) {
            res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'too many requests' }))
            return
          }

          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj, null, 2))
          }

          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            const action = u.searchParams.get('action') || 'tools'

            if (action === 'tools') {
              send(200, {
                ok: true,
                tools: [
                  { name: 'sea_list', description: '列出所有识海，带条数和最近更新时间' },
                  { name: 'sea_search', description: '按词查记忆。q 是你要查的词（必填），sea 选哪个海，limit 要几条' },
                  { name: 'sea_stats', description: '识海的现状：条数、分层、情绪分布' },
                ],
              })
              return
            }

            if (action === 'sea_list') {
              const bases = []
              try {
                for (const d of readdirSync(SEAS_DIR, { withFileTypes: true })) {
                  if (!d.isDirectory()) continue
                  const p = join(SEAS_DIR, d.name, 'data.json')
                  if (!existsSync(p)) continue
                  const data = readSea(d.name)
                  if (!data) continue
                  const alive = (data.points || []).filter((x) => !x.dead)
                  bases.push({ sea: d.name, points: alive.length, edges: (data.edges || []).length })
                }
              } catch {}
              send(200, { ok: true, seas: bases })
              return
            }

            if (action === 'sea_stats') {
              const sea = u.searchParams.get('sea') || 'main'
              const data = readSea(sea)
              if (!data) { send(404, { ok: false, error: 'no such sea' }); return }
              const alive = (data.points || []).filter((x) => !x.dead)
              const layers = {}
              const moods = {}
              for (const p of alive) {
                const L = p.layer || 'experience'
                layers[L] = (layers[L] || 0) + 1
                for (const [k, v] of Object.entries(p.emotion || {})) {
                  if (v > 0) moods[k] = (moods[k] || 0) + 1
                }
              }
              send(200, {
                ok: true, sea,
                points: alive.length,
                edges: (data.edges || []).length,
                layers,
                emotions: moods,
                core: alive.filter((x) => x.layer === 'core').length,
                dim: alive.filter((x) => !x.validUntil && decayOf(x) < 0.55).length,
              })
              return
            }

            if (action === 'add') {
              if (req.method !== 'POST') { send(405, { ok: false, error: '写入要用 POST' }); return }
              // 默认关闭。要显式 allow-write=1 才开。
              // 风险文档：「MCP 无限流，外部 Agent 疯狂调用写入接口」
              const allow = u.searchParams.get('allow-write') === '1'
              if (!allow) {
                send(403, { ok: false, error: 'writing via MCP is off by default. add &allow-write=1 to enable' })
                return
              }
              const q = (u.searchParams.get('q') || '').trim()
              const text = (u.searchParams.get('text') || '').trim()
              if (!q || !text) { send(400, { ok: false, error: 'need q (title) and text' }); return }
              const sea = u.searchParams.get('sea') || 'main'
              // 走和 memory_add 同一条路——门禁、四道门、全都过
              const argv = ['--title', q, '--text', text, '--sea', sea]
              const kind2 = u.searchParams.get('kind')
              if (kind2) argv.push('--kind', kind2)
              const pol2 = u.searchParams.get('polarity')
              if (pol2) argv.push('--polarity', pol2)
              const aw2 = u.searchParams.get('arousal')
              if (aw2) argv.push('--arousal', aw2)
              // 其它字段也要传，不然门禁形同虚设
              const fk2 = u.searchParams.get('fact-key')
              if (fk2) argv.push('--fact-key', fk2)
              const cf2 = u.searchParams.get('confidence')
              if (cf2) argv.push('--confidence', cf2)
              const im2 = u.searchParams.get('imp')
              if (im2) argv.push('--imp', im2)
              for (const c of u.searchParams.getAll('category')) if (c) argv.push('--category', c)
              for (const e of u.searchParams.getAll('entity')) if (e) argv.push('--entity', e)
              const fl2 = u.searchParams.get('her-felt')
              if (fl2) argv.push('--her-felt', fl2)
              const fw2 = u.searchParams.get('her-wanted')
              if (fw2) argv.push('--her-wanted', fw2)
              const fd2 = u.searchParams.get('her-did')
              if (fd2) argv.push('--her-did', fd2)
              const fr2 = u.searchParams.get('her-regret')
              if (fr2) argv.push('--her-regret', fr2)
              const log2 = await run(argv)
              audit('mcp-write', { sea, title: q.slice(0, 60) })
              send(200, { ok: true, log: log2 })
              return
            }

            if (action === 'sea_search') {
              const q = (u.searchParams.get('q') || '').trim()
              const sea = u.searchParams.get('sea') || 'main'
              const limit = Math.max(1, Math.min(20, Number(u.searchParams.get('limit') || 5)))
              if (!q) { send(400, { ok: false, error: 'missing q' }); return }
              const data = readSea(sea)
              if (!data) { send(404, { ok: false, error: 'no such sea' }); return }

              // 接口跟工具走同一条路：同一句话只该有一份答案（2026-11-19）
              try {
                const T = await import('./tools.js')
                const r = await T.searchTool.execute({ query: q, sea, limit, review: false })
                const ids = [...String(r.log || '').matchAll(/· #(\d+)/g)].map((m) => Number(m[1]))
                if (ids.length) {
                  const byId = new Map((data.points || []).map((p) => [Number(p.id), p]))
                  send(200, {
                    ok: true,
                    results: ids.slice(0, limit).map((id) => {
                      const p = byId.get(id) || {}
                      return {
                        id,
                        title: p.title,
                        text: String(p.text || '').slice(0, 200),
                        born: p.born,
                        arousal: p.arousal,
                        polarity: p.polarity,
                        layer: p.layer,
                        score: null,
                      }
                    }),
                  })
                  return
                }
              } catch {}

              // 用和 memory_search 一样的逻辑（简版：字面 + IDF）
              const idx = getIndex(sea, data)
              const qg = gramsOf(q, { single: q.length <= 1 })
              const wOf = (w) => (w.length === 3 ? 2 : (w.length === 1 ? 0.2 : 1)) * idx.idf(w)
              const qlen = Math.max(1, [...qg].reduce((s, w) => s + wOf(w), 0))
              const scored = []
              for (const p of data.points) {
                // 沉底的和删掉的一样，不进检索。真检索那边早就排了，简版漏了。
                if (p.dead || p.archived) continue
                const g = idx.grams.get(p.id)
                if (!g) continue
                let hit = 0
                for (const w of qg) if (g.t.has(w) || g.b.has(w)) hit += wOf(w)
                if (hit <= 0) continue
                const lenNorm = 1 / (1 + Math.log(1 + (g.t.size + g.b.size) / 300))
                scored.push({ p, score: hit / qlen * 0.7 * lenNorm })
              }
              scored.sort((a, b) => b.score - a.score)
              send(200, {
                ok: true,
                results: scored.slice(0, limit).map((x) => ({
                  id: x.p.id,
                  title: x.p.title,
                  text: String(x.p.text || '').slice(0, 200),
                  born: x.p.born,
                  arousal: x.p.arousal,
                  polarity: x.p.polarity,
                  layer: x.p.layer,
                  score: Number(x.score.toFixed(3)),
                })),
              })
              return
            }

            send(404, { ok: false, error: 'unknown action' })
          } catch (error) {
            send(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    ),
  )

  // 心脏状态：读一次，顺手按时间结算
  /* ---------- 壁纸素材 ----------
   * 视频和雪碧图是从 dsh-sea-skin 硬链过来的，放在 assets 里。
   * 那个插件不在 bundles 里加载不了，但它那 10 MB 的 background.mp4 是好的。
   * 走识海自己的路由发，前端脚本也由识海发。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/consciousness/skin',
        handler: async (req, res) => {
          const SKIN_TYPES = {
            'background.mp4': 'video/mp4',
            'sprite.webp': 'image/webp',
            'feiyu.png': 'image/png',
            'skin.js': 'text/javascript; charset=utf-8',
          }
          try {
            const url = new URL(req.url || '/', 'http://localhost')
            const file = decodeURIComponent(url.pathname.slice('/consciousness/skin'.length + 1))
            const type = SKIN_TYPES[file]
            if (!type) { res.writeHead(404); res.end(); return }
            const target = join(ASSETS, file)
            if (!existsSync(target)) { res.writeHead(404); res.end(); return }
            res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600' })
            res.end(readFileSync(target))
          } catch {
            try { res.writeHead(500); res.end() } catch {}
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/flavor/self',
        handler: async (req, res) => {
          // 2026-11-22：「性格」左栏——她自己这边。只读，不输入任何东西。
          // 数据来自每轮落盘的 flavor 日志；没有日志就回空，不编。
          try {
            const uu = new URL(req.url, 'http://127.0.0.1')
            const sea = String(uu.searchParams.get('sea') || 'main')
            const limit = Math.min(60, Math.max(5, Number(uu.searchParams.get('n')) || 30))
            const logPath = join(homedir(), '.dsh', 'consciousness-flavor-log.jsonl')
            let lines = []
            try {
              if (existsSync(logPath)) {
                const all = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
                lines = all.slice(-limit)
              }
            } catch {}
            const rows = []
            for (const l of lines) {
              try {
                const o = JSON.parse(l)
                if (!o || typeof o.score !== 'number') continue
                if (o.short === 'skip') continue
                rows.push({ at: Number(o.at) || 0, score: o.score, kinds: o.kinds || [], head: String(o.head || '') })
              } catch {}
            }
            const bad = rows.filter((r) => r.score >= 0.35).length
            const kinds = {}
            for (const r of rows) for (const k of r.kinds) kinds[k] = (kinds[k] || 0) + 1
            const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ kind: k, n: v }))
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              sea,
              rounds: rows.length,
              bad,
              rate: rows.length ? Number((bad / rows.length).toFixed(3)) : null,
              avg: rows.length ? Number((rows.reduce((a, r) => a + r.score, 0) / rows.length).toFixed(3)) : null,
              top,
              last: rows.slice(-5).reverse(),
              // 2026-11-22：页面要按时间倒序铺满，给全量明细（最多 200 条）
              rows: rows.slice(-200).reverse().map((r) => ({ at: r.at, score: r.score, kinds: r.kinds, head: r.head })),
              // 右栏（她学别人）也从这个接口出：新路由注册不上，就并进来，一条通的路比三条半通的路强
              style: (() => {
                try {
                  const all = listStyle(sea).map((p) => ({
                    key: p.styleKey,
                    pattern: String(p.title || ''),
                    cat: String(p.cat || ''),
                    count: Number(p.count) || 0,
                    days: Array.isArray(p.days) ? p.days.length : 0,
                    adopt: p.adopt === true,
                    noLearn: p.noLearn === true,
                    last: Number(p.lastSeenAt) || 0,
                  }))
                  all.sort((a, b) => (Number(b.last) || 0) - (Number(a.last) || 0))
                  return {
                    adopt: all.filter((x) => x.adopt && !x.noLearn).length,
                    watch: all.filter((x) => !x.adopt && !x.noLearn).length,
                    banned: all.filter((x) => x.noLearn).length,
                    list: all.slice(0, 40),
                  }
                } catch { return { adopt: 0, watch: 0, banned: 0, list: [] } }
              })(),
            }))
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
          }
        },
      },
      {
        kind: 'exact',
        path: '/consciousness/flavorstyle',
        handler: async (req, res) => {
          // 2026-11-22：「性格」右栏——她学别人这边。只读。
          try {
            const uu = new URL(req.url, 'http://127.0.0.1')
            const sea = String(uu.searchParams.get('sea') || 'main')
            const all = listStyle(sea).map((p) => ({
              key: p.styleKey,
              pattern: String(p.title || ''),
              cat: String(p.cat || ''),
              count: Number(p.count) || 0,
              days: Array.isArray(p.days) ? p.days.length : 0,
              adopt: p.adopt === true,
              noLearn: p.noLearn === true,
              conf: Number(p.conf) || 0,
              last: Number(p.lastSeenAt) || 0,
            }))
            // 2026-11-22：按时间倒序，新学到的在上
            all.sort((a, b) => (Number(b.last) || 0) - (Number(a.last) || 0))
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              sea,
              adopt: all.filter((x) => x.adopt && !x.noLearn).length,
              watch: all.filter((x) => !x.adopt && !x.noLearn).length,
              banned: all.filter((x) => x.noLearn).length,
              list: all.slice(0, 40),
            }))
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
          }
        },
      },
      {
        kind: 'exact',
        path: '/consciousness/flavor',
        handler: async (req, res) => {
          // 2026-11-22：给「性格」按钮用。只读：一段文字丢进尺子，回分数、腔名、命中原句。
          // 走 GET 是有意的：不写任何东西、不用读请求体。
          try {
            const uu = new URL(req.url, 'http://127.0.0.1')
            const text = String(uu.searchParams.get('text') || '').slice(0, 8000)
            if (!text.trim()) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: '没给文字' }))
              return
            }
            const r = aiflavor(text)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              score: r.score,
              kinds: r.kinds || [],
              hits: (r.hits || []).slice(0, 12).map((h) => ({ name: h.name, text: String(h.text || '').slice(0, 60) })),
              threshold: 0.35,
            }))
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
          }
        },
      },
      {
        kind: 'exact',
        path: '/consciousness/heart',
        handler: async (req, res) => {
          try {
            // 一键清零：POST /consciousness/heart?reset=1
            // 给发出去的版本留的「后悔药」——情绪判歪了、绷太久了，能手动抹平。
            // 2026-11-20：这一步是写（把情绪抹平），原来 GET 也能触发——预取、地址栏回车都算数。
            // 抹掉的是她当下的情绪，不能让人手滑一下就没。
            const uu = new URL(req.url, 'http://127.0.0.1')
            if (uu.searchParams.get('reset') === '1') {
              if (req.method !== 'POST') {
                res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ ok: false, error: '清零要用 POST' }))
                return
              }
              const clean = defaultMood(readHeart())
              clean.mix = {}
              clean.mixAt = Date.now()
              clean.grudge = 0
              clean.mood = 'calm'
              clean.moodStrength = 0
              clean.moodText = '平静'
              clean.moodPair = ''
              clean.pad = null
              clean.octant = ''
              clean.updated = Date.now()
              writeHeart(clean)
              if (res.headersSent || res.writableEnded) return
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify({ ok: true, reset: true, note: '情绪已清零，记忆没动。' }))
              return
            }
            const h = defaultMood(tickHeart(readHeart()))
            writeHeart(h)
            // 页面每秒轮询一次，请求随时可能被中断；已经发过就别再发
            if (res.headersSent || res.writableEnded) return
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              energy: h.energy,
              fatigue: h.fatigue,
              mood: h.mood || 'calm',
              moodStrength: h.moodStrength || 0,
              // 51 种情绪的完整状态
              mix: h.mix || {},
              moodText: (() => {
                try {
                  const m = globalThis.__dshLastMood
                  if (m && m.text && Date.now() - Number(m.at || 0) < 5 * 60 * 1000) return m.text
                } catch {}
                return h.moodText || (MOOD_LABEL[h.mood] || '平静')
              })(),
              moodPct: (() => {
                try {
                  const m = globalThis.__dshLastMood
                  if (m && Number.isFinite(m.pct) && Date.now() - Number(m.at || 0) < 5 * 60 * 1000) return m.pct
                } catch {}
                return Math.round((Number(h.moodStrength) || 0) * 100)
              })(),
              moodPair: h.moodPair || '',
              pad: h.pad || null,
              octant: h.octant || '',
              grudge: Number(h.grudge) || 0,
              // 骂人许可：让他在页面上看得见，不用猜
              swear: (() => {
                try {
                  const jj = globalThis.__dshLastJudge || {}
                  const key = (jj.react && jj.react.key) || h.mood || 'calm'
                  const inten = Number((jj.react && jj.react.intensity) || h.moodStrength || 0)
                  const heSwore = /废物|滚|傻|没救|蠢|闭嘴|去死|丢人/.test(String(jj.said || ''))
                  const r = allowSwear(key, inten, { heSwore })
                  return { allow: !!r.allow, why: String(r.why || ''), key, intensity: Number(inten.toFixed(2)) }
                } catch (e) { return null }
              })(),
              updated: h.updated,
              lastThought: h.lastThought || null,
              thoughts: h.thoughts || [],
              intake: h.intake || null,
              lastAdd: h.lastAdd || 0,
            }))
          } catch (error) {
            // 头已经发出去了就不能再发（ERR_HTTP_HEADERS_SENT 就是这里来的）
            if (res.headersSent || res.writableEnded) return
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }))
            } catch {}
          }
        },
      }),
    ),
  )
  // 外人进来：只给他情绪，不给咱们的事
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/visitor',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const who = String(u.searchParams.get('who') || '一个生人').slice(0, 12)
            const said = String(u.searchParams.get('text') || '').slice(0, 200)
            const vmod = await import('./visitor.js')
            return send(200, { ok: true, inject: vmod.visitorInject(who, said) })
          } catch (e) {
            return send(500, { ok: false, error: String((e && e.message) || e) })
          }
        },
      }),
    ),
  )

  // 模拟接口：把一个"他"说的话推进她一次，返回注入和数值
  // 只给自测/模拟器用；走的是**真管线**，不是假装。
  /* ---------- 念出来的那个文件 ----------
   * 浏览器不许 http 页面直接播 file://，所以由插件自己发出去。
   * 只发 voice 目录里 say-*.wav，别的一律不给。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/voice',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const name = String(u.searchParams.get('name') || '').trim()
            if (!/^say-[0-9A-Za-z._-]+\.wav$/.test(name)) { send(400, { ok: false, reason: '名字不对' }); return }
            const { VOICE_DIR } = await import('./voice.js')
            const fp = join(VOICE_DIR, name)
            if (!existsSync(fp)) { send(404, { ok: false, reason: '没这个文件' }); return }
            const buf = readFileSync(fp)
            res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': buf.length, 'cache-control': 'no-store' })
            res.end(buf)
          } catch (e) {
            send(500, { ok: false, reason: String((e && e.message) || e).slice(0, 120) })
          }
        },
      })),
  )

  /* ---------- 念这句 ----------
   * 插件自己不发声：不绑模型、不上传、不占显卡。
   * 把字交给用户自己配的 TTS（~/.dsh/consciousness-voice.json）。
   * 没配就明说"没接引擎"，不假装能响。
   */
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/speak',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          let out = { ok: false }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const text = String(u.searchParams.get('text') || '').trim()
            const emotion = String(u.searchParams.get('emotion') || '').trim()
            const { startSpeak, speakStatus, voiceReady } = await import('./voice.js')
            const jobId = String(u.searchParams.get('job') || '').trim()
            if (jobId) {
              out = speakStatus(jobId)
            } else if (!voiceReady()) {
              out = { ok: false, reason: '没配声音引擎', hint: '写一份 ~/.dsh/consciousness-voice.json，见 lib/voice.js 顶部' }
            } else {
              // 不在请求里等它念完：语音要跑几十秒到几分钟，等就把页面拖住了
              out = startSpeak(text, { emotion })
            }
          } catch (e) {
            out = { ok: false, reason: String((e && e.message) || e).slice(0, 160) }
          }
          send(200, out)
        },
      })),
  )

  // 沉底前自查：安静之后把"快掉但还值钱"的掂一遍。
  // 只涨 strength 的一半，不碰 lastSeen / recallCount / arousal——不装成被想起。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/consolidate',
        handler: async (req, res) => {
          // send 是每个 handler 自己声明的（这个文件里没有全局的）。
          // 第一次漏了声明，调用时抛 ReferenceError，被宿主包成 400 空正文。
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          let out = { ok: false }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const dry = u.searchParams.get('dry') !== '0'
            // 2026-11-20：真跑（dry=0）会给一批条目抬强度并写盘，原来 GET 也能触发。
            // 预览随便看，动手要 POST。
            if (!dry && req.method !== 'POST') { send(405, { ok: false, error: '真跑要用 POST' }); return }
            const sea = String(u.searchParams.get('sea') || 'main')
            const data = readSea(sea)
            const { consolidate, pickForReview } = await import('./consolidate.js')
            if (dry) {
              const r = pickForReview(data)
              out = { ok: true, dry: true, would: Math.min(12, r.pick.length), total: r.pick.length, reason: r.reason,
                sample: r.pick.slice(0, 5).map((x) => ({ id: x.point.id, r: x.r, imp: x.point.imp, title: String(x.point.title || '').slice(0, 16) })) }
            } else {
              const r = consolidate(data)
              if (r.n > 0) {
                const _lk3 = acquireWriteLock(sea, 8)
                try {
                  writeSea(sea, data)
                } finally {
                  // 2026-11-21：放锁失败原来一声不响，锁留在盘上，
                  // 后面每一笔写都要等它过期——跟 store 那个坑同一类。
                  try { _lk3 && _lk3.release && _lk3.release() } catch (e) {
                    try { audit('route-consolidate-lock-release-failed', { sea, err: String((e && e.code) || e).slice(0, 60) }) } catch {}
                  }
                }
              }
              out = { ok: true, dry: false, n: r.n, reason: r.reason }
            }
          } catch (e) {
            out = { ok: false, err: String((e && e.message) || e).slice(0, 160) }
          }
          // send 是 (状态码, 对象)，不是 (res, 状态码, 对象)——第一次写成三个参数，直接 400。
          send(200, out)
        },
      })),
  )

  // 体检：页面顶上那条横幅用。只报事实，不猜。
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/health',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = String(u.searchParams.get('sea') || 'main')
            const sid = String(u.searchParams.get('sid') || '').trim()
            const { existsSync } = await import('node:fs')
            const { PY_CANDIDATES } = await import('./paths.js')
            let py = ''
            for (const c of PY_CANDIDATES) {
              if (c === 'python') { py = py || 'python(系统PATH)'; continue }
              try { if (existsSync(c)) { py = c; break } } catch {}
            }
            const sess = await import('./session.js')
            const bound = sid ? (sess.seaForSession(sid) || '') : ''
            const all = await import('./seas.js')
            let count = 0
            try { count = (all.listSeas() || []).length } catch {}
            let points = 0
            try {
              const d = (await import('./store.js')).readSea(sea)
              points = d && Array.isArray(d.points) ? d.points.length : 0
            } catch {}
            send(200, {
              ok: true,
              sea,
              sid,
              bound: bound || '',
              boundBy: bound ? 'window' : (sid ? 'none(会用 main)' : 'unknown'),
              python: py,
              canWrite: !!py,
              seas: count,
              points,
              hint: '先说一句「查一下识海」，它才会去翻。',
            })
          } catch (e) {
            send(200, { ok: false, error: String((e && e.message) || e).slice(0, 160) })
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/sim',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const said = String(u.searchParams.get('text') || '').trim()
            const sid = String(u.searchParams.get('sid') || 'sim').trim()
            // 测试专用海 + 拦截：测试 sid 必须带 &sea=sandbox；带了就把这个 sid 绑到那个海。
            // 2026-11-08 出过事：假人读了他的私事，还把测试痕迹写进心脏。所以默认不许碰 main。
            let _seaReq = ''
            try {
              _seaReq = String(u.searchParams.get('sea') || '').trim()
              if (!_seaReq && /^(z|r|p|u|scene|test|probe)[-_]?\d/i.test(sid)) {
                // 这个 handler 里没有 send（别处才有），直接写响应。
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ ok: false, reason: '测试 sid 必须带 &sea=sandbox，别碰真库' }))
                return
              }
              if (_seaReq) {
                const m = await import('./session.js')
                // 签名是 bindSession(sea, sid)，别写反——第一次写反了，绑定没生效。
                if (m && typeof m.bindSession === 'function') m.bindSession(_seaReq, sid)
              }
              // A/B 开关：norot=1 时关掉身份轮换，别的一个字不改
              globalThis.__dshNoRot = u.searchParams.get('norot') === '1'
            } catch {}

            const fn = globalThis.__dshInjectBuild
            let inj = ''
            // 验具不能污染她：先把心脏文件拍个快照，跑完原样还回去。
            // 不这么做，每测一句都往她心里写一笔，下一句就被前一句带着走。
            let _snap = null
            // 注意：这里只回滚心脏文件，不回滚 __dshLastMood。
            // 2026-11-08 试过回滚它，结果 sim 显示的是回滚后的旧状态，测不出这一句的效果（撑不住那条就假红了）。
            try {
              const _p = HEART_FILE
              if (existsSync(_p)) _snap = { p: _p, body: readFileSync(_p, 'utf8') }
            } catch {}
            // shift=8 → 先把她往前拨 8 小时，再算这一轮。
            // 这样"过了一夜"能在测试里复现：情绪该落就落，记忆该淡就淡。
            try {
              const _shift = Number(new URL(req.url || '/', 'http://x').searchParams.get('shift') || 0) || 0
              if (_shift > 0 && _snap) {
                const hh = JSON.parse(_snap.body)
                const ms = _shift * 3600 * 1000
                if (hh.mixAt) hh.mixAt = Number(hh.mixAt) - ms
                if (hh.updated) hh.updated = Number(hh.updated) - ms
                if (hh.moodSince) hh.moodSince = Number(hh.moodSince) - ms
                writeFileSync(_snap.p, JSON.stringify(hh), 'utf8')
              }
            } catch {}
            if (typeof fn === 'function' && said) {
              try { inj = String(fn(sid, said) || '') } catch (e) { inj = 'ERR ' + String((e && e.message) || e) }
            }
            // persist=1 时不还原：连续深聊要让她顺着情绪走，不能每句都回到起点。
            try {
              const _keep = (new URL(req.url || '/', 'http://x').searchParams.get('persist') === '1')
              if (_snap && !_keep) writeFileSync(_snap.p, _snap.body, 'utf8')

            } catch {}
            const mood = defaultMood(tickHeart(readHeart()))
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              said,
              inject_len: inj.length,
              inject: inj,
              mood: mood.mood,
              strength: Number((mood.moodStrength || 0).toFixed(3)),
              dims: mood.dims || null,
              judge: (globalThis.__dshLastJudge && globalThis.__dshLastJudge.q === said) ? globalThis.__dshLastJudge : null,
              absence: mood.absence || null,
            }))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  // 热参数：改数字不用重启
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/live',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const key = String(u.searchParams.get('key') || '').trim()
            const hasVal = u.searchParams.has('value')
            let out = { ok: true }
            // 2026-11-20：带 key+value 就是改热参数（要落盘），原来 GET 也能改。
            // 读（不带 value）随便看；改要 POST。
            if (key && hasVal && req.method !== 'POST') {
              res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: '这个只能 POST 过来' }))
              return
            }
            if (key && hasVal) {
              const v = sane(key, u.searchParams.get('value'))
              const r = writeLive({ [key]: v })
              out = { ok: !!r.ok, set: { [key]: v }, now: r.now || readLive(), reason: r.reason || '' }
            } else {
              out = { ok: true, now: readLive(), defaults: DEFAULTS }
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(out))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  // 内观页：她自己那一半
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/inner-data',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = String(u.searchParams.get('sea') || 'main')
            const data = readSea(sea)
            const pts = (data && data.points) || []
            const mood = defaultMood(tickHeart(readHeart()))
            // 优先用心脏里存的那份 dims——UI 必须照着她真实的状态画画。
            // 之前这里从 pad 现算，导致"数据变了界面不变"，等于白改。
            const dims = (mood && mood.dims && typeof mood.dims === 'object' && !Array.isArray(mood.dims))
              ? mood.dims
              : projectDims((mood && mood.pad) || {})
            const md = readMode()
            let thoughts = listThoughts(12).map((x) => ({
              id: x.id, text: x.text, born: x.born, dim: x.dim,
              origin: x.origin, archived: !!x.archived, strength: x.strength,
            }))
            // 把"还没成句的想头"并进同一个列表：一句成句的话，一句生料，按时间排。
            // 数据不合并（生料写进念头池会吃掉每天三条的额度），只在出口合并。2026-11-11。
            try {
              const _tm = await loadLib('thinkauto.js')
              const raw = _tm.readThoughts().slice(0, 8).map((x) => {
                const op = (x.ops && x.ops[0]) || {}
                return {
                  id: 'raw-' + x.at,
                  text: '在想：' + String(x.seedTitle || '') + (op.hint ? ' —— ' + op.hint : ''),
                  born: x.at, dim: 'calm', origin: 'raw', archived: false, strength: 0.3,
                }
              })
              thoughts = thoughts.concat(raw).sort((a, b) => (Number(b.born) || 0) - (Number(a.born) || 0)).slice(0, 18)
            } catch {}
            const openPromises = pts
              .filter((p) => p && p.kind === 'promise' && !p.dead && p.promiseStatus !== 'done')
              .map((p) => String(p.promiseWhat || p.title || '').slice(0, 80))
            const pre = topItems(
              collect({ promises: openPromises.slice(0, 3), thoughts: listThoughts(3) }, Date.now()), 3, Date.now(),
            ).map((x) => ({ kind: x.kind, text: x.text, weight: x.weight }))
            const days = recentDays(14)
            const act = todayActivity()
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              level: md.level,
              levelText: { low: '关着', high: '活着（不花钱）', max: '会自己写念头' }[md.level] || md.level,
              thoughtsToday: md.thoughtsToday,
              dims,
              dimText: describeDimsL(dims),
              thoughts,
              stance: (() => {
                // 她怎么看这句：判定之外的那一层，给内观页显示
                try {
                  const _p = join(homedir(), '.dsh', 'consciousness-stance.json')
                  if (!existsSync(_p)) return null
                  const j = JSON.parse(readFileSync(_p, 'utf8').replace(/^\uFEFF/, ''))
                  if (!j || !j.at) return null
                  if (Date.now() - Number(j.at) > 2 * 3600 * 1000) return null   // 两小时内才算"这句"
                  return { label: String(j.label || ''), line: String(j.line || ''), kind: String(j.kind || ''), at: Number(j.at) }
                } catch { return null }
              })(),
              preoccupations: pre,
              moodline: days,
              series: recentSeries(72),
              trend: describeTrend(days),
              activity: act.line,
              damp: readDamp(),
              dampText: describeDamp(readDamp()),
              absence: null,
            }, null, 1))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  // 切档：/consciousness/inner/mood?level=low|high|max
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/inner/mood',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const level = String(u.searchParams.get('level') || '').trim()
            // 2026-11-20：切档是写（改她活着的档位、要落盘），原来 GET 也能切。
            if (level && req.method !== 'POST') {
              res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: '切档要用 POST' }))
              return
            }
            const r = setLevel(level)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: !!r.ok, level: r.level || '', before: r.before || '', reason: r.reason || '' }))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  // 内观页本体
  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/inner',
        handler: async (req, res) => {
          try {
            // 只留一份：内观现在只有识海里那个浮层。
            // 以前两份一模一样的界面各写各的，改错地方就会"改了看不见"。
            // 2026-11-11 深夜合并。
            res.writeHead(302, { location: '/consciousness?id=main&inner=1', 'cache-control': 'no-store' })
            res.end('')
          } catch (e) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('内观页还没装：' + String((e && e.message) || e))
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/handoff-state',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = String(u.searchParams.get('sea') || 'main')
            const hp = join(SEAS_DIR, sea, 'handoff.json')
            if (!isSeaName(sea)) throw new Error('bad sea name')
            let h = null
            try {
              if (existsSync(hp)) h = JSON.parse(readFileSync(hp, 'utf8').replace(/^\uFEFF/, ''))
            } catch {}
            const now = Date.now()
            const mins = h && h.at ? Math.round((now - Number(h.at)) / 60000) : -1
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              handoff: h,
              ageMinutes: mins,
              willSplice: mins >= 30,
              note: !h
                ? '还没有交接条——说一句话就会生一条'
                : (mins >= 30
                  ? '下次开口会带上【接上上次】'
                  : '同一个会话里，不复述'),
            }, null, 1))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/vector',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = String(u.searchParams.get('sea') || 'main')
            const data = readSea(sea)
            const st = vectorStats(sea, data)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              ok: true,
              ...st,
              note: st.status === 'healthy'
                ? '近似层正常（本机是字面哈希，不是真语义模型），每条记忆都算过一次'
                : (st.status === 'unhealthy'
                  ? '近似这层这会儿不可用——只能按字面找'
                  : '有些记忆没算过近似、或者改过字没重算，近似这路会缺'),
            }, null, 1))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  off.push(
    safeEffect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/consciousness/verify',
        handler: async (req, res) => {
          try {
            const u = new URL(req.url || '/', 'http://x')
            const sea = String(u.searchParams.get('sea') || 'main')
            const only = String(u.searchParams.get('file') || '')
            const r = verifyRaw(sea, only)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(r, null, 1))
          } catch (e) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
            } catch {}
          }
        },
      }),
    ),
  )

  return off
}
