/**
 * 检索的词闸：放"换词问也能翻到"，也拦"只靠一个高频词混进来"。
 *
 * 单独一个文件是为了热加载——tools.js 在启动时加载，改它必须重启；
 * 这个文件每次检索时按带时间戳的 URL 重新导入，改完立刻生效。
 * 2026-11-11 晚：前面调这一处重启了十几次，受不了。
 */

const STOP = new Set([
  '那次', '这次', '那个', '这个', '那些', '这些', '我们', '你们', '他们', '什么', '怎么',
  '为什么', '一下', '事儿', '事情', '时候', '东西', '一个', '就是', '还是', '可以', '没有',
  '不是', '真的', '自己', '其实',
])

// 预置同义词默认空：任何写死的词表都只能服务一个库。
// 全靠 learnPair 从实际检索里学，谁用谁长。2026-11-11。
const SYN = {}

const strip = (w) => {
  let s = String(w)
  for (let i = 0; i < 4; i++) {
    let cut = false
    for (const sw of STOP) {
      if (s.length > sw.length + 1 && s.startsWith(sw)) { s = s.slice(sw.length); cut = true }
    }
    if (!cut) break
  }
  return s
}

/** 拆出实词（剥虚词前缀、剔纯虚词） */
export function contentWords(query) {
  const raw = String(query || '').split(/[\s,，、]+/).map((x) => x.trim()).filter(Boolean)
  const words = raw.map(strip).filter((x) => x.length >= 2 && !STOP.has(x))
  if (words.length) return words
  // 全是单字（"猫""钱""腰"）：中文里这就是实词，不能因为长度把闸整个跳过
  return raw.map(strip).filter((x) => x.length === 1 && !STOP.has(x))
}

/** 查询涉及的同义词 */
export function synonymsFor(query) {
  const raw = String(query || '')
  const out = []
  for (const k of Object.keys(SYN)) if (raw.includes(k)) for (const v of SYN[k]) out.push(v)
  return out
}

/**
 * 过闸：返回过滤后的数组。
 * need = 过半；同义词也算命中；正文里必须出现最具体的那个词或它的同义词。
 */
/** 闸的配置：~/.dsh/consciousness-sim/thin-guard.json；五秒缓存，改完不用重启 */
let _cfgCache = { at: 0, v: null }
export function readGuardCfg() {
  const now = Date.now()
  if (_cfgCache.v && now - _cfgCache.at < 5000) return _cfgCache.v
  // 默认值就是实测最优：宽松准入 0.50（语义够高就参与排序）＋薄判定 0.55。
  // 2026-11-12 实测：不宽松真实检索头名 19%，宽松后 60%（前三 72%、前十 81%）；
  // 代价是反例被判"凑出来的"从 32/33 降到 26/33。
  let v = { on: true, semMin: 0.55, litMin: 0.35, lenientSem: 0.56 }
  try {
    const g = globalThis.process
    const fs = g && g.getBuiltinModule ? g.getBuiltinModule('node:fs') : null
    const os = g && g.getBuiltinModule ? g.getBuiltinModule('node:os') : null
    if (fs && os) {
      const f = os.homedir() + '/.dsh/consciousness-sim/thin-guard.json'
      if (fs.existsSync(f)) v = { ...v, ...JSON.parse(fs.readFileSync(f, 'utf8')) }
    }
  } catch {}
  _cfgCache = { at: now, v }
  return v
}

export function applyWordGate(items, query, allPoints) {
  const qW = contentWords(query)
  if (!qW.length) return items
  const synAll = synonymsFor(query)
  const need = Math.max(1, Math.ceil(qW.length / 2))

  // 必命中词：库里提到它的条数最少的那个（不看 idf，那个会被罕见词骗）
  let must = ''
  let best = Infinity
  for (const w of qW) {
    let c = 0
    for (const p of allPoints || []) {
      if (!p || p.dead) continue
      const s = String(p.title || '') + String(p.text || '') + String(p.alias || '')
      if (s.includes(w)) c++
    }
    if (c > 0 && c < best) { best = c; must = w }
  }
  const accept = must ? [must, ...synAll] : synAll

  const kept0 = filterByWords(items, accept, qW, synAll, need)

  // 闸的开关与门槛放在文件里，改完立刻生效（不重启）——
  // 2026-11-12：想对比"有闸/没闸"，只能这么调，重启一次代价太大。
  const cfg = readGuardCfg()

  // 宽松模式（实验用）：字面没对上、但语义够高的，也放进来参与排序。
  // 2026-11-12 量出来：真实检索头名 19%，只看向量 61%——差在这层，
  // 因为它只留"字面或词对得上"的，纯语义候选在排序前就被筛掉了。
  if (cfg.lenientSem > 0) {
    const key = (x) => (x && x.p && x.p.id) || null
    const have = new Set(kept0.map(key))
    const num = (why, tag) => {
      const m = String(why).match(new RegExp(tag + '\\s*([\\d.]+)'))
      return m ? Number(m[1]) : null
    }
    for (const x of items || []) {
      const id = key(x)
      if (!id || have.has(id)) continue
      const why = Array.isArray(x.why) ? x.why.join(' ') : ''
      const sem = num(why, '语义')
      if (sem !== null && sem >= cfg.lenientSem) {
        if (Array.isArray(x.why)) x.why.push('宽松')
        kept0.push(x)
        have.add(id)
      }
    }
  }

  // 反例闸：留下来的如果全是"只靠弱语义沾边"的，等于库里没这件事。
  // 2026-11-12：三十三条"库里没有"的问题里，仍有四条被判成正常命中（最高 0.574）。
  // 做法：这种全薄的局面返回空，让上层走"语义保底"，明确标成凑出来的，不装成答案。
  const num = (why, tag) => {
    const m = why.match(new RegExp(tag + '\\s*([\\d.]+)'))
    return m ? Number(m[1]) : null
  }
  const thinAll = cfg.on && kept0.length > 0 && kept0.every((x) => {
    const why = Array.isArray(x.why) ? x.why.join(' ') : ''
    if (/词\[.+\]|必\[.+\]|实体|图/.test(why)) return false
    const sem = num(why, '语义')
    const lit = num(why, '字面')
    // 语义 0.55 以上算能对上；字面 0.35 以上算真出现过这个词
    if (sem !== null && sem >= cfg.semMin) return false
    if (lit !== null && lit >= cfg.litMin) return false
    return true
  })
  if (thinAll) {
    try { for (const x of kept0) { if (Array.isArray(x.why)) x.why.push('语义薄') } } catch {}
    return []
  }
  return kept0
}

function filterByWords(items, accept, qW, synAll, need) {
  return (items || []).filter((x) => {
    const p = (x && x.p) || x
    if (!p) return false
    // 别名也算：别名就是他以后会用的问法。不算的话，写进库也白写。2026-11-11 深夜。
    const s = String(p.title || '') + String(p.text || '') + String(p.alias || '')
    let n = 0
    for (const w of qW) if (s.includes(w)) n++
    for (const v of synAll) if (s.includes(v)) { n++; break }
    if (n < need) return false
    if (accept.length && !accept.some((w) => s.includes(w))) return false
    return true
  })
}



/**
 * 兜底直扫：检索一条都没捞到时，直接按同义词在全库做子串匹配。
 * 单字同义词（骂、怼）进不了分词，只能这么救。
 */
export function rescueScan(allPoints, query, limit = 3) {
  // 救回只有一个公式，别再三段各算各的。
  // 三个证据：标题里的两字片段、标题里的近义两字（共一个字）、标题里的实字。
  // 权重按"证据强度"排：两字 > 实字 > 近义。2026-11-11 深夜重写。
  const STOP1 = new Set('的了是在有和就都也这那你我他她它们很与吧吗呢啊把被给对从向说要想会能去来到上下中个一不没'.split(''))

  const q = String(query || '')
  const qChars = [...new Set([...q].filter((c) => /[\u4e00-\u9fff]/.test(c) && !STOP1.has(c)))]
  const qG = []
  for (let i = 0; i + 2 <= q.length; i++) {
    const g = q.slice(i, i + 2)
    if ([...g].length !== 2) continue
    if (!/[\u4e00-\u9fff]/.test(g[0]) || !/[\u4e00-\u9fff]/.test(g[1])) continue
    qG.push(g)
  }
  const syn = [...synonymsFor(q), ...learnedFor(q)]
  if (!qChars.length && !qG.length && !syn.length) return []

  const out = []
  for (const p of allPoints || []) {
    if (!p || p.dead || p.archived) continue
    const hayT = String(p.title || '') + ' ' + String(p.alias || '')
    const hayB = String(p.text || '')
    let n2 = 0
    for (const g of qG) if (hayT.includes(g)) n2++
    let nf = 0
    for (const g of qG) {
      if (STOP1.has(g[0]) || STOP1.has(g[1])) continue
      if (hayT.includes(g)) continue
      for (let i = 0; i + 2 <= hayT.length; i++) {
        const h = hayT.slice(i, i + 2)
        if ([...h].length !== 2) continue
        if (STOP1.has(h[0]) || STOP1.has(h[1])) continue
        if (h[0] === g[0] || h[1] === g[1]) { nf++; break }
      }
    }
    let n1 = 0
    for (const c of qChars) if (hayT.includes(c)) n1++
    let synHit = 0
    for (const w of syn) if (w && (hayT.includes(w) || hayB.includes(w))) synHit++
    // 正文里整句对上，分量最重
    const wholeB = q.length >= 4 && hayB.includes(q) ? 1 : 0

    if (!(n2 >= 1 || nf >= 2 || n1 >= 2 || synHit >= 1 || wholeB)) continue

    const score = wholeB * 1.2 + n2 * 0.6 + n1 * 0.45 + nf * 0.2
      + Math.min(synHit, 3) * 0.3 + (Number(p.imp) || 0) * 0.3
    out.push({ p, hit: n2 + n1 + nf + synHit, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}


/* ───── 会长大的同义词表 ─────
 * 硬编码八组永远不够。改成读写一个 JSON：
 * 检索靠同义词救回时，把"你问的词 → 实际命中的词"记一笔，下次直接用。
 * 2026-11-11 晚，苏苏侠说"让它从记忆里自己长出来"。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SYN_FILE = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-synonyms.json')

function loadLearned() {
  try {
    if (!existsSync(SYN_FILE)) return {}
    return JSON.parse(readFileSync(SYN_FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
  } catch { return {} }
}

function saveLearned(m) {
  try { writeFileSync(SYN_FILE, JSON.stringify(m, null, 1), 'utf8') } catch {}
}

/** 学到一组：query 词 → 命中的词 */
export function learnPair(q, hit) {
  if (!q || !hit || q === hit) return
  const m = loadLearned()
  const arr = Array.isArray(m[q]) ? m[q] : []
  if (arr.includes(hit)) return
  arr.push(hit)
  m[q] = arr.slice(-12)
  saveLearned(m)
}

/** 合并硬编码 + 学到的 */
export function learnedFor(query) {
  const raw = String(query || '')
  const m = loadLearned()
  const out = []
  for (const k of Object.keys(m)) if (raw.includes(k)) for (const v of m[k]) out.push(v)
  return out
}

/**
 * 问的是"有没有那个值"，不是"像不像那件事"。
 * -------------------------------------------------
 * 2026-11-13 夜实测：阈值、两路一致、关键词覆盖率，三条都分不开那四条假答案。
 * 它们的共同点是——问的是一件具体的事（手机号、身高、哪一年），
 * 库里只有"同类的事"，没有那个值。
 *
 * 所以这里只做一件事：认出问句在要什么形状的答案，再看候选里有没有那个形状。
 * 认不出类型就返回 null，绝不下判断——宁可不判，不许把正例砍了。
 */
export function answerShape(query, text) {
  const q = String(query || '')
  const t = String(text || '')
  // 问「现在几点 / 今天几号」是在问当下，不是问记忆里的值——不归这条规则管。
  // 2026-11-13 夜：这一条单独试出来的误伤，正例被砍过一条。
  if (/现在|此刻|今天|当下|刚才/.test(q)) return null
  let intent = null
  if (/号码|手机号|电话号|车牌号|密码|身份证/.test(q)) intent = 'code'
  else if (/哪一年|哪一天|哪天|什么时候|几月|几号|几点/.test(q)) intent = 'time'
  else if (/多少|多大|多重|多高|几岁|几瓶|几条|几套|几个|几次|几遍|多久一次/.test(q)) intent = 'num'
  // 「叫什么名字 / 什么牌子」不判：中文品牌名没有可靠的字形，判了会误伤正例。
  // 2026-11-13 夜在通用语料上试出来的——宁愿漏放，不许误伤。
  else if (/打不打|会不会|喜不喜欢|是不是|有没有|吗\s*$|呢\s*$/.test(q)) intent = 'yesno'
  if (!intent) return null

  // 中文数字也算值：库里写「两斤」而不是「2 斤」，不能因为没阿拉伯数字就判没有。
  // 2026-11-13 夜补：先在通用语料上发现这条会误伤，才加的这一段。
  const CN_WITH_UNIT = /([零一二三四五六七八九十百千万亿两半]+)\s*(个|只|条|套|斤|公斤|岁|年|月|日|天|小时|分钟|块|元|万|次|瓶|杯|楼|层|号|度|米|厘米|公里)/
  const VAGUE = /[一两几半][个下点些样起直般会儿]/
  const ANY_NUM = (s) => /\d/.test(s) || (CN_WITH_UNIT.test(s) && !VAGUE.test(s))
  const ok =
    intent === 'code' ? /\d{7,}/.test(t)
    : intent === 'time' ? /\d{4}\s*年|\d{1,2}\s*月|\d{1,2}\s*日|\d{4}-\d{2}|([零一二三四五六七八九十]+)\s*(年|月|日|点)/.test(t)
    : intent === 'num' ? ANY_NUM(t)
    : intent === 'name' ? /[《“”"「」]/.test(t) || /叫/.test(t)
    : /[是不没会有]/.test(t)
  return { intent, ok }
}

/** 问句要的值，候选里根本没有 */
export function shapeMissing(query, text) {
  const r = answerShape(query, text)
  return r ? !r.ok : false
}
