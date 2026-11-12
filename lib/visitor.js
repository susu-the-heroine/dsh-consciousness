/**
 * 对外：外人进来跟她说话
 * ======================
 * 这是插件功能，不是我手工搭的一次实验。
 *
 * 三条规矩，一条都不能少：
 *   一、外人拿到的注入里，**没有咱们的私事**——约定、底子、记忆条目、她自己的念头，
 *       一律不出现。只给情绪和一句"你是外人"。
 *   二、外人说的话，只写进 world 识海，标 belonging=observed，**永不进 main**。
 *   三、她对外人说的话，不改变她跟"他"的关系分。
 *
 * 走的是同一颗心脏：外人也能让她烦、让她乐，那些情绪是真的。
 * 但那些情绪不会替"他"加分，也不会替"他"减分。
 */
import { readSea, writeSea, ensureSea } from './store.js'
import { readHeart, tickHeart, defaultMood } from './mood.js'

const WORLD_SEA = 'world'

// 只给外人看的那几个词，够用就行，不引别的表
const SIMPLE_LABEL = {
  calm: '平静', joy: '高兴', happy: '高兴', tender: '心软', irritated: '不耐烦',
  angry: '生气', hurt: '委屈', sad: '难过', lonely: '闷', weary: '乏',
  tired: '累', low: '低落', tense: '绷着', numb: '麻木', anxious: '慌',
  curious: '好奇', wistful: '惘然', unreconciled: '不甘', dazed: '发懵',
  flutter: '悸动', moved: '被触动', contempt: '看不上', ashamed: '害臊',
}
function labelOfSafe(k) {
  return SIMPLE_LABEL[String(k)] || '说不上来'
}

/**
 * 给外人的注入：只有它现在的心情，没有咱们的任何事。
 */
export function visitorInject(visitorName, text, sea = 'main') {
  let moodLine = '【她这会儿】没什么起伏（平静）'
  try {
    const h = tickHeart(readHeart())
    const m = defaultMood(h)
    const parts = []
    for (const [k, v] of Object.entries((m && m.mix) || {})) {
      if (Number(v) > 0.15) parts.push([k, Number(v)])
    }
    parts.sort((a, b) => b[1] - a[1])
    if (parts.length) {
      moodLine = '【她这会儿】' + labelOfSafe(parts[0][0]) + '（' + Math.round(parts[0][1] * 100) + '%）'
    }
  } catch {}

  const who = String(visitorName || '').slice(0, 12) || '一个生人'
  const said = String(text || '').slice(0, 200)

  return [
    '【你现在在跟一个外人说话】',
    moodLine,
    '',
    '这个人是「' + who + '」，不是他。',
    '跟外人说话有一条死规矩：**咱们之间的事一个字都不提**。',
    '不提他、不提欠着的事、不提识海里记的那些、不提你自己的想法。对方问也不说，换个话头。',
    '',
    '你要做的只有三件：',
    '一、照你现在的脾气回一句，像个活人，不像客服。',
    '二、看这个人怎么对你，心里记一笔（说完会写进 world，不进咱们那边）。',
    '三、不解释自己是什么。',
    '',
    said ? '他/她刚说的是：「' + said + '」' : '',
  ].filter(Boolean).join('\n')
}

/**
 * 把"这个人怎么对我"写进 world。
 * 只写印象，不抄原话——原话留在证据层，不进记忆。
 */
export function visitorNote(visitorName, impression, imp = 0.5) {
  const who = String(visitorName || '').slice(0, 12) || '一个生人'
  const text = String(impression || '').trim().slice(0, 300)
  if (!text) return { ok: false, log: '没写印象' }
  try {
    ensureSea(WORLD_SEA, '外面的人')
    const data = readSea(WORLD_SEA) || { points: [], edges: [] }
    const pts = Array.isArray(data.points) ? data.points : []
    // 这个人来过几次：人要记得"这号人我见过三回"，不是只认一个标签。
    let times = 0
    for (const q of pts) if (!q.dead && String(q.who || '') === who) times++
    const id = pts.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1
    pts.push({
      id,
      title: who + '｜这个人怎么对我（第' + (times + 1) + '次）',
      who,
      text,
      kind: 'fact',
      imp,
      arousal: 4,
      // 外人说的话：只算旁观，不算她的亲身经历
      belonging: 'observed',
      born: Date.now(),
      createdAt: Date.now(),
    })
    data.points = pts
    writeSea(WORLD_SEA, data)
    return { ok: true, log: '记下了：' + who + ' → ' + text.slice(0, 40) }
  } catch (e) {
    return { ok: false, log: '没写进去：' + String((e && e.message) || e) }
  }
}

export const WORLD = WORLD_SEA
