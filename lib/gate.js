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
  // 问句里的「多少/几号/什么」不算实词，去了才知道该找什么（2026-11-18 夜）
  const _ask = /(多少|几号|几个|什么|怎么办|咋办|咋样|怎么样)$/
  let words = raw.map((x) => strip(x).replace(_ask, '')).filter((x) => x.length >= 2 && !STOP.has(x))
  // 一整句没空格：拆成二字组当实词，否则整句被当成一个词去正文里找（2026-11-18 夜）
  if (words.length === 1 && words[0].length >= 4) {
    const s0 = words[0]
    const gs = []
    for (let i2 = 0; i2 + 1 < s0.length; i2++) { const g = s0.slice(i2, i2 + 2); if (!STOP.has(g)) gs.push(g) }
    if (gs.length) words = gs
  }
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
  // 默认值就是实测最优：宽松准入 0.56（语义够高就参与排序）＋薄判定 0.55。
  // 2026-11-20 逐行核对：注释里原来写 0.50，实现是 0.56，按实现改注释，不动数。
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

  let kept0 = filterByWords(items, accept, qW, synAll, need)
  // 2026-11-19 夜（P98）：必命中词可能是跨词的碎片（比如「情欠」），库里根本没有这个词，
  // 于是把整批都筛没了，正确的条目反而进不来。筛空就退回「只按同义词、门槛降一档」再筛一次。
  if (!kept0.length && items && items.length) {
    const _relax = filterByWords(items, synAll, qW, synAll, Math.max(1, need - 1))
    if (_relax.length) kept0 = _relax
  }

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
import { writeJsonAtomic } from './json-file.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

// 2026-11-20：原来只认 USERPROFILE。那个变量只有 Windows 有——Mac/Linux 上它为空，
// 路径就变成相对的 .dsh/...，学到的东西写进了「当前目录」。这里补 HOME 和 homedir 兜底。
const SYN_FILE = join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh', 'consciousness-synonyms.json')

function loadLearned() {
  try {
    if (!existsSync(SYN_FILE)) return {}
    return JSON.parse(readFileSync(SYN_FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
  } catch { return {} }
}

function saveLearned(m) {
  writeJsonAtomic(SYN_FILE, m)
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
/**
 * 这问句是不是在要「一个值」——数字，或者一个专名（牌子、型号、外号、考点、备注）。
 * 2026-11-19 夜：十三道硬答全栽在这。问的是值，正文里根本没有那个值，
 * 闸只看见「演出」「电脑」撞上了字面，就以为有。所以要单独问一句：你要的是不是值。
 */
export function asksValue(query) {
  const q = String(query || '')
  if (/多少|多重|多大|几块|几个|几次|几级|第几|几点|几号|票价|价格|刷新率/.test(q)) return 'num'
  if (/什么牌子|什么型号|什么镜头|什么牌|外号|考点|备注|车牌|尾数|哪一版|第几组|第几级/.test(q)) return 'name'
  return null
}

/** 问句在要哪种形状的值；认不出返回 null（2026-11-19 从 answerShape 里提出来给整片海用） */
export function shapeIntent(query) {
  const q = String(query || '')
  if (/现在|此刻|今天|当下|刚才/.test(q)) return null  // 2026-11-19 修：原来只要有「密码」两个字就判成要号码——「视觉密码」「记忆密码」这种名词全被拒了。
  // 改成只在真的要一个值的时候才判：谁家的密码、密码是多少。
  if (/手机号|电话号|车牌号|身份证|银行卡号|卡号|尾数|航班号|门牌号|密码是多少|密码多少|密码是几|wi-?fi\s*密码|开机密码|解锁密码/i.test(q)) return 'code'
  if (/哪一年|哪一天|哪天|什么时候|几月|几号|几点/.test(q)) return 'time'
  if (/多少|多大|多重|多高|几岁|几瓶|几条|几套|几个|几次|几遍|多久一次/.test(q)) return 'num'
  if (/打不打|会不会|喜不喜欢|是不是|有没有|吗\s*$|呢\s*$/.test(q)) return 'yesno'
  // 2026-11-19：问一个具体名字/牌子/版本/门店/组别——答案是一段专名，不是数字。
  // 这类问句以前全落到"普通检索"，库里没这个人这件事，它也会抓一条沾边的顶上。
  if (/叫什么|叫啥|姓什么|姓啥|什么名字|什么牌子|什么牌|哪一版|哪家|哪个医院|哪家诊所|谁写|谁说的|什么型号|第几组|第几级|几级/.test(q)) return 'entity'
  return null
}

/**
 * 问句里的实义二字组：滤掉人称、虚词、量词、疑问词和属性词，只留下"在问什么东西"。
 * 中文没空格，按二字组切；带功能字的组合一律丢掉，剩下的像"蜥蜴""门牌""镜头""刷新"。
 * 用途：entity 类问句拿它去整片海里对——一个都撞不上，就是没记过这件事。
 */
export function subjectTerms(query) {
  const q = String(query || '').replace(/[（）()【】\[\]？?！!。，,、；;：:""''“”‘’《》—\-…\s]/g, '')
  const FUNC = new Set(
    ('他她它我你咱们的那这那个只台本场张次件辆双间位名条部把块家组级第几什么多少哪谁吗呢吧啊呀' +
      '叫叫做姓挂号号码码牌子版本类型颜色价格价钱多少钱几块多少元收送买看用去修拍报订跑弹背养练点做干弄' +
      '上下午年月日天周次时候前后里外中间前后左右东西南北中').split('')
  )
  const out = []
  for (let i = 0; i + 1 < q.length; i++) {
    const a = q[i]
    const b = q[i + 1]
    if (FUNC.has(a) || FUNC.has(b)) continue
    const g = a + b
    if (!out.includes(g)) out.push(g)
  }
  return out.slice(0, 12)
}

export function answerShape(query, text) {
  const q = String(query || '')
  const t = String(text || '')
  // 问「现在几点 / 今天几号」是在问当下，不是问记忆里的值——不归这条规则管。
  // 2026-11-13 夜：这一条单独试出来的误伤，正例被砍过一条。
  if (/现在|此刻|今天|当下|刚才/.test(q)) return null
  const intent = shapeIntent(q)
  if (!intent) return null
  // 2026-11-19：entity 类问的是专名，形状判据不适用（"猫叫什么名字"答案里也没有"是不没会有"）。
  // 这一类的"没记过"由检索侧的主体词判据负责，这里放手。
  if (intent === 'entity') return null

  // 中文数字也算值：库里写「两斤」而不是「2 斤」，不能因为没阿拉伯数字就判没有。
  // 2026-11-13 夜补：先在通用语料上发现这条会误伤，才加的这一段。
  const CN_WITH_UNIT = /(?<![上下本这那])([零一二三四五六七八九十百千万亿两半]+)\s*(个|只|条|套|斤|公斤|岁|年|月|日|天|小时|分钟|块|元|万|次|瓶|杯|楼|层|号|度|米|厘米|公里)/
  const VAGUE = /[一两几半][个下点些样起直般会儿]/
  // 「六千二」「三百」这种不带单位的也要认；「一个学徒」这种虚指仍要排除。
  const CN_BARE = /[二三四五六七八九十百千万两]{2,}/
  const ANY_NUM = (s) => /\d/.test(s) || (CN_WITH_UNIT.test(s) && !VAGUE.test(s)) || CN_BARE.test(s)
  const ok =
    intent === 'code' ? /\d{7,}/.test(t)
    // 2026-11-21：时间值只认了中文数字和「2026年」「11月」这种，漏了阿拉伯数字的「3点」「11点半」「23:50」。
    // 实测：问「他问我几点的时候我为什么答不上来」，库里那条正文写着「有一次你下午3点跟我说…」
    // 却被判成「没记过」，一条都不返回。补上阿拉伯数字的时刻写法。
    : intent === 'time' ? /\d{4}\s*年|\d{1,2}\s*月|\d{1,2}\s*日|\d{4}-\d{2}|\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*点|([零一二三四五六七八九十]+)\s*(年|月|日|点)/.test(t)
    : intent === 'num' ? ANY_NUM(t)
    // 2026-11-20：引号里带标点的不是名字（相邻两个引号会被误配成一对）。
    : intent === 'name' ? /[《“"「][^，。、；：！？\s》”"」]{1,12}[》”"」]/.test(t) || /叫/.test(t)
    : /[是不没会有]/.test(t)
  return { intent, ok }
}

/** 问句要的值，候选里根本没有 */
export function shapeMissing(query, text) {
  const r = answerShape(query, text)
  return r ? !r.ok : false
}
