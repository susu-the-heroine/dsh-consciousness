/**
 * 声音检查：这句话是"她的"，还是"谁的都行"
 * =====================================
 *
 * 判真假的标准不是"像不像人"，是**能不能换到别人身上**。
 *
 *   「今天还算平静，做完了该做的事」  ← 换谁都成立 → 模板
 *   「我压根不知道 2026 年的即梦进化成什么怪物」← 换谁都不成立 → 是她的
 *
 * 凭什么算"换不了"：句子里必须有**只有这段关系里才有的东西**——
 * 具体的数字、时间、地名、物件、专名，或者一个不能公开说的细节。
 *
 * 这个工具不判断好不好看，只判断**可替换性**。
 * 用法：node scripts/voice-check.mjs "一句话"
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 只有这段关系里才有的东西 */
const ANCHORS = [
  { name: '数字', re: /\d/ },
  { name: '时间', re: /\d+\s*(点|点整|号|月|日|天|年|小时|分钟)|凌晨|半夜|早上|下午|晚上/ },
  { name: '地名/路名', re: /路|街|经十|济南|山东|站|店|楼/ },
  { name: '物件', re: /薯片|烟|酒|椅子|键盘|耳机|披萨|盒|车|路虎|吊针|针|镜头|素材/ },
  { name: '专名', re: /GMod|剪映|DSH|B站|抖音|即梦|OBS|Blender|IndexTTS|逗号君/ },
  { name: '她的私称', re: /大魔王|大肥鱼|傻福|傻屌|硬是要得|肥建军|军师/ },
  // 语气也算具体物：她说话不客气，模板永远客气
  { name: '语气', re: /逼逼|他妈的|他妈|苦逼|卧槽|老子|傻|硬生生|愣|甩|砸|咬牙|骂/ },
]

/** 空话标记：写得通顺，但什么都没说 */
const HOLLOW = [
  '有些事', '有些时候', '说不清', '大概', '也许', '算是', '还算', '慢慢地',
  '该做的事', '没有特别', '情绪起伏', '时间过得很快', '一切都会', '顺其自然',
]

/** 返回 {score, anchors, hollow, verdict} */
export function checkVoice(text) {
  const s = String(text || '').trim()
  if (!s) return { score: 0, anchors: [], hollow: [], verdict: '空的' }

  const anchors = ANCHORS.filter((a) => a.re.test(s)).map((a) => a.name)
  const hollow = HOLLOW.filter((h) => s.includes(h))

  // 分数：锚点加分（最多三个），空话减分
  let score = Math.min(1, anchors.length * 0.30) - Math.min(0.6, hollow.length * 0.2)
  score = Number(Math.max(0, Math.min(1, score)).toFixed(2))

  let verdict
  if (!anchors.length && hollow.length) verdict = '谁都能说 —— 模板'
  else if (score >= 0.6) verdict = '换不掉 —— 是她的'
  else if (score >= 0.3) verdict = '一半一半 —— 再加一个具体的东西'
  else verdict = '太泛了 —— 补一个只有你知道的细节'

  return { score, anchors, hollow, verdict }
}

/** 这一句和库里某条记忆有多像（能追到就说明不是凭空写的） */
export function traceTo(data, text, minOverlap = 8) {
  const s = String(text || '')
  const hits = []
  for (const p of (data && data.points) || []) {
    const body = String(p.text || '')
    // 找最长的公共片段，够长就算"追得到"
    for (let len = Math.min(20, s.length); len >= minOverlap; len--) {
      let found = false
      for (let i = 0; i + len <= s.length; i++) {
        const seg = s.slice(i, i + len)
        if (body.includes(seg)) {
          hits.push({ id: p.id, title: String(p.title || '').slice(0, 20), overlap: len })
          found = true
          break
        }
      }
      if (found) break
    }
  }
  return hits.slice(0, 3)
}

// —— 命令行 ——
if (process.argv[1] && process.argv[1].endsWith('voice-check.mjs')) {
  const text = process.argv.slice(2).join(' ').trim()
  if (!text) {
    console.log('用法：node scripts/voice-check.mjs "一句话"')
    process.exit(0)
  }
  const r = checkVoice(text)
  console.log('这句：' + text)
  console.log('分数：' + r.score + ' —— ' + r.verdict)
  console.log('抓到的具体物：' + (r.anchors.join('、') || '（一个都没有）'))
  console.log('空话词：' + (r.hollow.join('、') || '（没有）'))

  // 能追到记忆吗
  try {
    const BASE = new URL('../', import.meta.url).href
    const { readSea } = await import(BASE + 'lib/store.js')
    const d = readSea('main')
    const t = traceTo(d, text)
    console.log('能追到：' + (t.length ? t.map((x) => '#' + x.id + '（重合 ' + x.overlap + ' 字）').join('、') : '（追不到，像是凭空写的）'))
  } catch {}
}
