/**
 * 广度抓取：十个领域，各抓对话对
 * ============================
 * 目的：不是攒字数，是攒**结构**——一来一往的对话，且有对象（带"你"）。
 * 数据源用排行榜（不需要登录），每个领域取前几个热门视频，
 * 抓热门评论 + 楼中楼，凑够每个领域约 50 对。
 *
 * 输出：~/.dsh/记忆/_外人语料.jsonl（追加、去重）
 * 跑法：node scripts/harvest-voices.mjs [每领域对数]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT_DIR = join(homedir(), '.dsh', '记忆')
const OUT = join(OUT_DIR, '_外人语料.jsonl')
const TARGET = Number(process.argv[2]) || 50
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
}

const DOMAINS = [
  { name: '单机游戏', rid: 17 },
  { name: '美食', rid: 211 },
  { name: '动物', rid: 217 },
  { name: '知识', rid: 36 },
  { name: '数码', rid: 188 },
  { name: '运动', rid: 234 },
  { name: '影视', rid: 181 },
  { name: '游戏综合', rid: 4 },
  { name: '音乐', rid: 3 },
  { name: '娱乐', rid: 5 },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

function clean(s) {
  let t = String(s || '')
    .replace(/@[\w\u4e00-\u9fa5\-]+/g, '')
    .replace(/\[[^\]]{1,8}\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u200b-\u200f\ufe0f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const n = [...t].length
  if (n < 5 || n > 90) return ''
  if (/^[0-9a-zA-Z\s.,!?！？。，、~～-]+$/.test(t)) return ''
  return t
}

// 已存在
const existed = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean) : []
const seen = new Set()
for (const line of existed) {
  try { seen.add(JSON.parse(line).text) } catch {}
}
const fresh = []

let statThread = 0
let statComment = 0
let statDanmaku = 0

for (const dom of DOMAINS) {
  let pairs = 0
  let list = []
  try {
    const r = await getJson('https://api.bilibili.com/x/web-interface/ranking/v2?rid=' + dom.rid + '&type=all')
    list = (r.code === 0 && r.data && r.data.list) || []
  } catch (e) {
    console.log('  ' + dom.name + ' → 排行榜失败 ' + e.message)
    continue
  }
  for (const v of list) {
    if (pairs >= TARGET) break
    const aid = v.aid
    const cid = v.cid
    const bv = v.bvid
    try {
      for (let pn = 1; pn <= 2 && pairs < TARGET; pn++) {
        const c = await getJson(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&ps=20&pn=${pn}`)
        if (c.code !== 0 || !c.data || !c.data.replies) break
        for (const root of c.data.replies) {
          const rt = clean(root.content && root.content.message)
          if (rt && !seen.has(rt)) { seen.add(rt); fresh.push({ text: rt, from: 'comment', domain: dom.name, bv }); statComment++ }
          if (!Array.isArray(root.replies)) continue
          for (const sub of root.replies) {
            const st = clean(sub.content && sub.content.message)
            if (!rt || !st) continue
            const pair = rt + ' ／ ' + st
            if (seen.has(pair)) continue
            seen.add(pair)
            fresh.push({ text: pair, from: 'thread', domain: dom.name, bv })
            statThread++
            pairs++
            if (pairs >= TARGET) break
          }
          if (pairs >= TARGET) break
        }
        if (!c.data.replies.length) break
        await sleep(320)
      }
      // 少量弹幕当对照
      if (pairs < TARGET) {
        try {
          const xml = await getText('https://comment.bilibili.com/' + cid + '.xml')
          for (const m of [...xml.matchAll(/<d p="[^"]*">([^<]*)<\/d>/g)].slice(0, 12)) {
            let t = ''
            try { t = clean(decodeURIComponent(escape(m[1]))) } catch { t = clean(m[1]) }
            if (t && !seen.has(t)) { seen.add(t); fresh.push({ text: t, from: 'danmaku', domain: dom.name, bv }); statDanmaku++ }
          }
        } catch {}
      }
      await sleep(320)
    } catch (e) {
      // 单个视频失败不影响全局
    }
  }
  console.log('  ' + dom.name.padEnd(6) + ' 对话对 ' + String(pairs).padStart(3) + '（累计新增 ' + fresh.length + '）')
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, existed.concat(fresh.map((r) => JSON.stringify(r))).join('\n') + '\n', 'utf8')

const threads = fresh.filter((r) => r.from === 'thread').length
console.log('\n新增 ' + fresh.length + ' 条（对话对 ' + threads + '｜单条评论 ' + statComment + '｜弹幕 ' + statDanmaku + '）')
console.log('库里总共 ' + (existed.length + fresh.length) + ' 条')
console.log('落盘：', OUT)
