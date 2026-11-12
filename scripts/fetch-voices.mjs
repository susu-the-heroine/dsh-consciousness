/**
 * 抓「别人的话」
 * ============
 * 从 B 站公开接口抓评论和弹幕，存成外人语料。
 * 目的：测"她对陌生人会不会失常"、以后做分身——不是拿它教她说话。
 *
 * 只抓公开内容，抓到就落盘，去重、按长度筛。
 * 输出：~/.dsh/记忆/_外人语料.jsonl
 *
 * 跑法：
 *   node scripts/fetch-voices.mjs BV1xxx BV1yyy ...
 *   node scripts/fetch-voices.mjs --from-report   # 从 bili-duty 报告里翻 BV 号
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT_DIR = join(homedir(), '.dsh', '记忆')
const OUT = join(OUT_DIR, '_外人语料.jsonl')
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
}

const getJson = async (url) => {
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}
const getText = async (url) => {
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.text()
}

/** 从 bili-duty 的报告里翻 BV 号 */
function fromReport() {
  const dir = join(homedir(), '.dsh', 'bili-duty', 'out')
  const set = new Set()
  if (!existsSync(dir)) return []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const t = readFileSync(join(dir, f), 'utf8')
    for (const m of t.matchAll(/BV[0-9A-Za-z]{10}/g)) set.add(m[0])
  }
  return [...set]
}

/** 清洗：去 @、去表情标记、压空白；太短太长都不要 */
function clean(s) {
  let t = String(s || '')
    .replace(/@[\w\u4e00-\u9fa5\-]+/g, '')
    .replace(/\[[^\]]{1,8}\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u200b-\u200f\ufe0f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const n = [...t].length
  if (n < 5 || n > 80) return ''
  if (/^[0-9a-zA-Z\s.,!?！？。，、~～-]+$/.test(t)) return ''
  return t
}

const args = process.argv.slice(2)
const WANT_THREADS = args.includes('--threads')
let bvs = args.filter((a) => /^BV/.test(a))
if (!bvs.length || args.includes('--from-report')) {
  const found = fromReport()
  bvs = [...new Set([...bvs, ...found])]
}
if (!bvs.length) {
  console.log('没有 BV 号。用法：node scripts/fetch-voices.mjs BV1xxx BV1yyy')
  process.exit(1)
}
console.log('要抓的视频：', bvs.length, '个')

const rows = []
let stat = { videos: 0, comments: 0, danmaku: 0, kept: 0 }

for (const bv of bvs) {
  let info = null
  try {
    const v = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + bv)
    if (v.code !== 0) { console.log('  ' + bv + ' → ' + v.message); continue }
    info = v.data
  } catch (e) { console.log('  ' + bv + ' → 视图失败 ' + e.message); continue }
  stat.videos++
  const aid = info.aid
  const cid = info.cid

  // 评论：翻三页
  for (let pn = 1; pn <= 3; pn++) {
    try {
      const c = await getJson(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&ps=20&pn=${pn}`)
      if (c.code !== 0 || !c.data || !c.data.replies) break
      for (const r of c.data.replies) {
        stat.comments++
        const t = clean(r.content && r.content.message)
        if (t) { rows.push({ text: t, from: 'comment', bv }); stat.kept++ }
        // 楼中楼：有人回他。这一对才是"对话"，有对象
        if (WANT_THREADS && Array.isArray(r.replies) && r.replies.length) {
          const root = t
          for (const sub of r.replies) {
            const s = clean(sub.content && sub.content.message)
            if (root && s) { rows.push({ text: root + ' ／ ' + s, from: 'thread', bv }); stat.kept++ }
          }
        }
      }
      if (c.data.replies.length < 20) break
      await new Promise((r) => setTimeout(r, 350))
    } catch { break }
  }

  // 弹幕
  try {
    const xml = await getText('https://comment.bilibili.com/' + cid + '.xml')
    const all = [...xml.matchAll(/<d p="[^"]*">([^<]*)<\/d>/g)].map((m) => m[1])
    for (const raw of all) {
      stat.danmaku++
      let t = ''
      try { t = clean(decodeURIComponent(escape(raw))) } catch { t = clean(raw) }
      if (t) { rows.push({ text: t, from: 'danmaku', bv }); stat.kept++ }
    }
  } catch (e) { console.log('  ' + bv + ' → 弹幕失败 ' + e.message) }

  await new Promise((r) => setTimeout(r, 350))
  console.log('  ' + bv + ' 《' + String(info.title).slice(0, 24) + '》 累计 ' + rows.length + ' 条')
}

// 去重
const seen = new Set()
const uniq = []
for (const r of rows) {
  if (seen.has(r.text)) continue
  seen.add(r.text)
  uniq.push(r)
}

mkdirSync(OUT_DIR, { recursive: true })
const existed = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean) : []
const existSeen = new Set(existed.map((x) => { try { return JSON.parse(x).text } catch { return '' } }))
const fresh = uniq.filter((r) => !existSeen.has(r.text))

writeFileSync(OUT, existed.concat(fresh.map((r) => JSON.stringify(r))).join('\n') + '\n', 'utf8')

const nThread = rows.filter((r) => r.from === 'thread').length
console.log('\n抓到：评论 ' + stat.comments + ' 条、弹幕 ' + stat.danmaku + ' 条、楼中楼 ' + nThread + ' 对')
console.log('去重后新增', fresh.length, '条｜库里总共', existed.length + fresh.length, '条')
console.log('落盘：', OUT)
console.log('\n前十条长这样：')
for (const r of fresh.slice(0, 10)) console.log('  [' + r.from + '] ' + r.text)
