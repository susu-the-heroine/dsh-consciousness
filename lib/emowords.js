/**
 * 情绪词库：决定一句话该喂给身体什么事件。
 *
 * 之前这些词写死在注入里，要加一个"nb"就得改代码。
 * 现在抽出来：内置一批通用的，另外读一个 JSON，缺什么往里加，不用动代码。
 *
 * 为什么没有"自动学"：学要有标注。系统没法自己判断你这句是夸还是骂——
 * 猜出来的标签喂进去，激素就跟着猜一起歪。宁可让人加词，不让它瞎学。
 * 2026-11-11 深夜。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-emowords.json')

// 内置：先覆盖最常出现的口语。宁可宽一点——宽了顶多算错一次，窄了就等于没反应。
const BUILTIN = {
  tender: ['谢谢', '辛苦', '爱你', '想你', '抱抱', '乖', '疼你', '别累着', '辛苦了', '在吗', '早点', '注意身体', '照顾好'],
  // 强词：出现就算夸，不管在什么句子里
  praiseStrong: ['nb', '牛逼', '牛批', '有点东西', '真行', '靠谱', '好使', '厉害', '服了', '绝了', '顶'],
  // 弱词：只在短句里算夸，长句里出现不算（"行吧，那就这样"不是夸）
  praiseWeak: ['可以', '不错', '漂亮', '稳', '成了', '对了', '真行啊'],
  scold: ['傻', '蠢', '垃圾', '滚', '废', '闭嘴', '放屁', '扯淡', '他妈', '你妈', '妈的',
    '傻逼', '沙雕', '傻屌', '智障', '狗东西', '废物', '别bb', '服了你', '算了算了'],
}

// 用户自己加的
function loadExtra() {
  try {
    if (!existsSync(FILE)) return {}
    const j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
    const out = {}
    for (const k of ['tender', 'scold', 'praise']) {
      if (Array.isArray(j[k])) out[k] = j[k].map(String).filter(Boolean)
    }
    return out
  } catch { return {} }
}

/** 合并后的词库 */
export function wordbook() {
  const extra = loadExtra()
  const out = {}
  for (const k of Object.keys(BUILTIN)) {
    out[k] = [...BUILTIN[k], ...(extra[k] || [])]
  }
  // 用户加的词默认当"强词"处理：人家特意加的，不该被长短限制
  out.praiseStrong = [...(out.praiseStrong || []), ...(extra.praise || [])]
  return out
}

/**
 * 判一句话属于哪类事件。
 * 顺序有讲究：软话 > 骂 > 夸，因为骂里常夹软话（"你他妈辛苦了"其实是夸），
 * 而夸里夹骂多半是反话——所以骂要排在夸前面。
 */
export function kindOf(text) {
  const s = String(text || '')
  if (!s.trim()) return 'talk'
  const w = wordbook()
  const has = (arr) => arr.some((x) => x && s.includes(x))
  const n = [...s].length

  if (has(w.tender)) return 'tender'
  if (has(w.scold)) return 'scold'

  // 反着说的不算夸：「行不行」「不行」「就行吧」都是在说事，不是夸
  const negated = /不行|行不行|可行|就行吧|行吧|算了|可以吧|还行/.test(s)

  // 强词不用看长短
  if (has(w.praiseStrong || [])) {
    if (!negated || /nb|牛逼|牛批|绝了|顶/.test(s)) return 'praise'
  }
  // 弱词只在短句里算：长句里"可以"多半是在说条件
  if (!negated && n <= 8 && has(w.praiseWeak || [])) return 'praise'
  return 'talk'
}

/**
 * 学一个词。
 *
 * 没有标注就没有学习。这里能借的标注只有一种：**他下一句的反应**。
 * 上一句判成闲话、下一句他明显夸/骂了，那说明上一句其实是那个调子——
 * 把上一句里最可能是关键词的那一段记下来，下次就认得。
 *
 * 只记短的（2–4 个字）、只记没见过的、每类最多 200 条，旧的先掉。
 * 学错了也没关系：下次认错，还能被下一句再纠正回来。
 */
const STORE = { tender: [], scold: [], praise: [] }

export function learnWord(word, kind) {
  const w = String(word || '').trim()
  const k = String(kind || '')
  if (!w || !STORE[k]) return { ok: false }
  if ([...w].length < 2 || [...w].length > 4) return { ok: false }

  let j = {}
  try {
    if (existsSync(FILE)) j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
  } catch { j = {} }
  for (const kk of ['tender', 'scold', 'praise']) {
    if (!Array.isArray(j[kk])) j[kk] = []
  }
  if (j[k].includes(w) || BUILTIN[k].includes(w)) return { ok: true, dup: true }
  // 一个词不许同时在两类里：先说明它唯一
  for (const kk of Object.keys(j)) {
    if (kk !== k) j[kk] = j[kk].filter((x) => x !== w)
  }
  j[k].push(w)
  if (j[k].length > 200) j[k] = j[k].slice(-200)
  try {
    writeFileSync(FILE, JSON.stringify(j, null, 1), 'utf8')
    return { ok: true, learned: w, kind: k }
  } catch { return { ok: false } }
}

/**
 * 从一句话里挑最可能是"那个词"的一段。
 * 短句整句收（"我靠"这种本身就是一个词），长句取最靠前的 2–4 字。
 */
export function candidateWord(text) {
  const s = String(text || '').replace(/[\s，。！？、,.!?~…—\-]+/g, ' ').trim()
  if (!s) return ''
  const parts = s.split(' ').filter(Boolean)
  if (parts.length === 1) {
    const one = parts[0]
    return [...one].length >= 2 && [...one].length <= 4 ? one : [...one].slice(0, 3).join('')
  }
  for (const p2 of parts) {
    const n = [...p2].length
    if (n >= 2 && n <= 4) return p2
  }
  return ''
}
