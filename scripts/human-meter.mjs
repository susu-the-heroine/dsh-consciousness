/**
 * 像人仪表盘
 * ==========
 *
 *   node scripts/human-meter.mjs <文件或目录> [更多...]
 *
 * 只数能数出来的东西，不猜。用来回答一个问题：
 * 「这次改完，是更像他了，还是更像客服了？」
 *
 * 数什么：
 *   段落长度中位、段数
 *   表格行（`|` 开头）——他不许有
 *   「咱们」与「我们」的比
 *   问号、感叹号
 *   列举腔（首先/其次/总之/综上/值得注意）
 *   定义腔（是……不是……、指的是、本质上）
 *   开头是不是那句招牌、结尾是不是那句收束
 */
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BAN_LIST = ['首先', '其次', '再次', '最后说', '总之', '综上', '值得注意', '综上所', '一来', '二来']
const BAN_DEF = ['本质上是', '指的是', '意味着', '也就是说', '所谓的']
const AGENCY = ['打算','决定','忍住','记得','记着','想','挑','选','琢磨','盘算']
const SIGN_OPEN = /^卧槽[，,]?\s*(大魔王|兄弟)/
const SIGN_END = /硬是要得[！!]?\s*$/

function filesOf(target) {
  try {
    const st = statSync(target)
    if (st.isFile()) return [target]
    return readdirSync(target).filter((f) => /\.(md|txt)$/i.test(f)).map((f) => join(target, f))
  } catch {
    return []
  }
}

function paragraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s && !/^#/.test(s) && !/^```/.test(s))
}

function median(list) {
  if (!list.length) return 0
  const a = list.slice().sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)
}

function count(text, words) {
  let n = 0
  for (const w of words) {
    const re = new RegExp(w, 'g')
    n += (String(text).match(re) || []).length
  }
  return n
}

export function meter(text) {
  const t = String(text || '')
  const ps = paragraphs(t)
  const lens = ps.map((p) => p.replace(/\s/g, '').length)
  const tableRows = t.split('\n').filter((l) => /^\s*\|/.test(l)).length
  const zan = (t.match(/咱们/g) || []).length
  const women = (t.match(/我们/g) || []).length
  return {
    chars: t.replace(/\s/g, '').length,
    paras: ps.length,
    paraLenMedian: median(lens),
    tableRows,
    zan,
    women,
    zanRatio: zan + women ? Math.round((zan / (zan + women)) * 100) / 100 : null,
    q: (t.match(/[？?]/g) || []).length,
    ex: (t.match(/[！!]/g) || []).length,
    banList: count(t, BAN_LIST),
    agency: count(t, AGENCY),
    banDef: count(t, BAN_DEF),
    signOpen: SIGN_OPEN.test(t.trim()) ? 1 : 0,
    signEnd: SIGN_END.test(t.trim()) ? 1 : 0,
  }
}


/**
 * 风格漂移：拿死数去卡，不看感觉。
 * 依据 377 条原话的骨架：段 5–8、段长 70–90、感叹号 4–8、问号 1–2、表格 0。
 * 只报挂哪几项，不判好坏——这是闸门，不是分数。
 */
export function styleDrift(m, tone) {
  const bad = []
  const t = tone || 'any'
  if (t === 'chat') {
    if (m.tableRows > 0) bad.push('表格 ' + m.tableRows)
    if (m.paras < 3 || m.paras > 6) bad.push('段数 ' + m.paras)
    if (m.paraLenMedian < 50 || m.paraLenMedian > 110) bad.push('段长中位 ' + m.paraLenMedian)
    if (m.banList > 0) bad.push('列举腔 ' + m.banList)
    return bad
  }
  if (t === 'lyrical') {
    if (m.tableRows > 0) bad.push('表格 ' + m.tableRows)
    if (m.paras < 8 || m.paras > 14) bad.push('段数 ' + m.paras)
    if (m.paraLenMedian < 80 || m.paraLenMedian > 120) bad.push('段长中位 ' + m.paraLenMedian)
    if (m.banList > 0) bad.push('列举腔 ' + m.banList)
    return bad
  }
  if (t === 'any') {
    // 宽档：只卡底线（表格、列举腔、没人称、不像话的段数），不拿一个中位数卡死三种档。
    if (m.tableRows > 0) bad.push('表格 ' + m.tableRows)
    if (m.paras < 3 || m.paras > 14) bad.push('段数 ' + m.paras)
    if (m.paraLenMedian < 40 || m.paraLenMedian > 120) bad.push('段长中位 ' + m.paraLenMedian)
    if (m.banList > 0) bad.push('列举腔 ' + m.banList)
    if (m.zan === 0) bad.push('没说咱们')
    return bad
  }
  if (m.tableRows > 0) bad.push('表格 ' + m.tableRows)
  if (m.paras < 5 || m.paras > 8) bad.push('段数 ' + m.paras)
  if (m.paraLenMedian < 70 || m.paraLenMedian > 90) bad.push('段长中位 ' + m.paraLenMedian)
  if (m.ex < 4 || m.ex > 8) bad.push('感叹号 ' + m.ex)
  if (m.q < 1 || m.q > 2) bad.push('问号 ' + m.q)
  if (m.zan === 0) bad.push('没说咱们')
  if (m.banList > 0) bad.push('列举腔 ' + m.banList)
  return bad
}
function fmt(m) {
  return [
    `字数 ${m.chars}`,
    `段 ${m.paras}（中位 ${m.paraLenMedian} 字）`,
    `表格行 ${m.tableRows}`,
    `咱们/我们 ${m.zan}/${m.women}${m.zanRatio === null ? '' : '（咱们 ' + Math.round(m.zanRatio * 100) + '%）'}`,
    `问号 ${m.q} · 感叹号 ${m.ex}`,
    `列举腔 ${m.banList} · 定义腔 ${m.banDef} · 自主词 ${m.agency || 0}`,
    `招牌开头 ${m.signOpen ? '有' : '无'} · 收束 ${m.signEnd ? '有' : '无'}`,
  ].join(' · ')
}

if (process.argv[1] && process.argv[1].endsWith('human-meter.mjs')) {
  const targets = process.argv.slice(2)
  if (!targets.length) {
    console.log('用法：node scripts/human-meter.mjs <文件或目录> [更多...]')
    process.exit(1)
  }
  let all = []
  for (const t of targets) {
    for (const f of filesOf(t)) {
      const m = meter(readFileSync(f, 'utf8'))
      all.push(m)
      console.log('\n' + f)
      console.log('  ' + fmt(m))
      const _bad = styleDrift(m, process.env.C2_TONE || 'any')
      console.log('  ' + (_bad.length ? '挂：' + _bad.join(' · ') : '过：骨架全对'))
    }
  }
  if (all.length > 1) {
    const merged = {
      chars: 0, paras: 0, tableRows: 0, zan: 0, women: 0, q: 0, ex: 0, banList: 0, banDef: 0,
      paraLenMedian: median(all.map((x) => x.paraLenMedian)),
      // 2026-11-21：合计这一行原来没带这三项，于是不管每份文件有没有招牌开头与收束，
      // 合计永远报「无」「无」——把最该看的两项在汇总时抹平了。这里补上。
      agency: 0,
      signOpen: all.every((x) => x.signOpen) ? 1 : 0,
      signEnd: all.every((x) => x.signEnd) ? 1 : 0,
    }
    for (const m of all) {
      merged.chars += m.chars
      merged.paras += m.paras
      merged.tableRows += m.tableRows
      merged.zan += m.zan
      merged.women += m.women
      merged.q += m.q
      merged.ex += m.ex
      merged.banList += m.banList
      merged.banDef += m.banDef
      merged.agency += m.agency || 0
    }
    merged.zanRatio = merged.zan + merged.women ? Math.round((merged.zan / (merged.zan + merged.women)) * 100) / 100 : null
    console.log('\n合计')
    console.log('  ' + fmt(merged))
  }
}
