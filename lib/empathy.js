/**
 * 共情映射：他的情绪 → 她的反应
 * ==========================
 * 之前是直接把他的情绪 key 贴到她身上——
 * 他说「我气死了」，注入里写「她挺生气」。那是他的气，不是她的。
 *
 * 人不是复制情绪，是回应情绪：
 *   他气，而且是冲她来的 → 她委屈 / 慌 / 顶回去
 *   他气，是气别的事       → 她跟着急（同仇，但强度低）
 *   他难过 / 累            → 她心疼
 *   他高兴                 → 她跟着高兴
 *
 * 这层只做映射，不动强度算法。
 */

/** 这句话是不是冲她来的 */
import { isBanter, isSarcasm, isInsult, isPraise } from './banter.js'

export function isAtHer(text) {
  const s = String(text || '')
  // 闹着玩的不算冲她：带笑、自己说了是逗、狗头这些。
  // 骂的是"事"不是"她"：你他妈又崩了 / 你他妈卡死了 / 又挂了
  // 这些脏话后面跟的是状态或物件，冲的不是人。
  if (/你他妈?|你他吗|妈的就?/.test(s) && /崩了|卡死|卡住|挂了|不行了|又错|又断|报错|闪退|掉线/.test(s)) return false
  if (/你这|这破|这烂|这傻|这玩意/.test(s)) {
    // 「你这游戏真难」「这破玩意又崩」——都是骂物
    if (/游戏|电脑|代码|视频|插件|软件|机器|手机|脚本|地图|模型|玩意|东西|网/.test(s)) return false
  }
  if (isBanter(s).banter) return false
  // 「你这游戏真难」「你这代码写得烂」——骂的是物，不是她。
  if (/你这(的)?(游戏|电脑|代码|视频|插件|软件|机器|手机|脚本|地图|模型)/.test(s)) return false
  return /你每次都|你从来|你怎么又|你他妈|你个|你就|你能不能|你居然|又说错|你又忘/.test(s)
}

/** 他的情绪是"难受型"还是"高兴型" */
const UP = new Set(['joy', 'happy', 'excited', 'proud', 'relieved', 'grateful', 'tender', 'fond', 'amused'])
const DOWN = new Set(['sad', 'dejected', 'lonely', 'hurt', 'weary', 'tired', 'drained', 'hopeless'])
const HOT = new Set(['angry', 'furious', 'irritated', 'annoyed', 'disgusted', 'contempt'])

/**
 * @param {{emoKey:string, intensity:number}} his 判出来的他的情绪
 * @param {string} text 他说的原话
 * @returns {{emoKey:string, intensity:number, note:string}}
 */
export function empathyOf(his, text) {
  const k = String((his && his.emoKey) || 'calm')
  const i = Number((his && his.intensity) || 0)
  // 情绪词库认不出「废物」「滚出去」「蠢得没救了」，靠它判会把骂人的句子当平静。
  if (isInsult(String(text || '')).insult) {
    return { emoKey: 'hurt', intensity: 0.6, note: '他在骂我' }
  }

  const _sar = isSarcasm(text)
  if (_sar.sarcasm === true) {
    return { emoKey: 'irritated', intensity: Math.min(0.7, Math.max(0.45, i * 0.8)), note: '他在阴阳我' }
  }
  // 听不准就别装懂：轻顶一句，别委屈也别当夸奖收下
  if (_sar.sarcasm === 'unsure') {
    // 0.3 会被每轮 18% 的衰减吃掉，等于没生效。给到 0.45，才顶得住。
    return { emoKey: 'irritated', intensity: 0.45, note: '听不准他是夸还是损，轻轻顶一句' }
  }
  // 他说自己忙、累、跑了一天 → 心疼，不是绷着
  if (/忙了一天|忙死|累死|累了一天|加班|跑了一天|困死/.test(String(text || ''))) {
    return { emoKey: 'tender', intensity: 0.4, note: '他今天累着了' }
  }

  // 好消息也要有反应：视频爆了、过万了、终于成了。
  // 以前这种句子一律平静——她像个不关心的会计。
  if (/(视频|片子|账号|这条).*(爆|火了|过万|上热门|起量)|终于(成|过|做好|搞定|发出)/.test(String(text || ''))) {
    return { emoKey: 'joy', intensity: 0.6, note: '好消息' }
  }

  // 三个字的情绪词：短查询会走字面兜底，得先拿一票。
  {
    const s = String(text || '').trim()
    const three = {
      '烦死了': ['angry', 0.55], '气死了': ['angry', 0.6], '累死了': ['tender', 0.4],
      '困死了': ['weary', 0.45], '饿死了': ['tender', 0.35], '笑死了': ['joy', 0.5],
      '想哭': ['hurt', 0.5], '火大': ['angry', 0.55], '憋屈': ['hurt', 0.5],
      '崩溃': ['hurt', 0.65], '真开心': ['joy', 0.6], '太好了': ['joy', 0.55],
    }
    if (three[s]) return { emoKey: three[s][0], intensity: three[s][1], note: '三个字的实话' }
  }

  // 他自己说慌、说焦虑、睡不着——测试清单第四条就靠这条。
  // 以前这种句子判平静，三条测试里这一条一直不合格。
  if (/我(也|有点|真的|特别|最近)?(焦虑|慌|紧张|睡不着|失眠|心里没底|发毛)/.test(String(text || ''))) {
    return { emoKey: 'tense', intensity: 0.5, note: '他自己说慌' }
  }
  // 「这破玩意又崩了」——没带脏字，但一样是冲事上火
  if (/这破|破玩意|破烂|这烂|又坏了/.test(String(text || '')) && /崩|坏|挂|卡|错|不行/.test(String(text || ''))) {
    return { emoKey: 'angry', intensity: 0.4, note: '东西又坏了' }
  }

  // 脏话 + 坏事 = 冲事上火，不是平静
  // 少一个「的」就认不出：「你他妈又崩了」以前判成平静。
  if (/操|草|靠|妈的|他妈的|他妈|tmd|卧槽/.test(String(text || '')) && /报错|又崩|白干|又错|又挂|卡死|崩了/.test(String(text || ''))) {
    return { emoKey: 'angry', intensity: 0.45, note: '他在骂这破事' }
  }

  // 他说自己没人管：饭凉了、没吃、十三个小时、退学了、当我没说。
  // 这些句子以前被判成平静，她就一直绷着不动——深聊实测出来的。
  if (/饭凉|没吃饭|还没吃|一口没吃|饿着|十三个小时|十四个小时|退学|没人管|没人问|一个人待着/.test(String(text || ''))) {
    return { emoKey: 'tender', intensity: 0.42, note: '他今天没人管' }
  }
  // 「当我没说」是把自己缩回去，扎人
  if (/当我没说|算了不说了|你就当我/.test(String(text || ''))) {
    return { emoKey: 'hurt', intensity: 0.45, note: '他把话咽回去了' }
  }

  // 家常话：聊的是日子、吃、路、班、钱、活。
  // 以前这种一律判平静，她的情绪就冻在那个词上——深聊实测出来的。
  // 给一点点推力，不抢主情绪，只让她心里动一下。
  {
    const s = String(text || '')
    // 收紧过：以前只要句子里有"天气"，一句「今天天气不错」就被判成心疼。
    // 现在要求：够长、有"我"（或咱）、而且不是纯评天气。
    const _hasSelf = /我|咱|堵|加班|忙到|赶|排队|开会/.test(s)
    const _pureWeather = /天气(不错|挺好|真好|可以)/.test(s) && s.length < 12
    if (s.length >= 7 && _hasSelf && !_pureWeather
        && /今天|昨天|明天|早上|中午|晚上|吃了|吃饭|路上|堵|上班|下班|活儿|干活|钱|下雨|下雪/.test(s)) {
      return { emoKey: 'tender', intensity: 0.16, note: '他说的是日子' }
    }
  }

  // 真丧事：爹妈亲人走了。这种句子判成平静是最伤人的。
  if (/(妈|爸|爹|娘|爷|奶|姥|舅|姨|哥|姐|弟|妹|朋友|兄弟)\s*(死了|去世|走了|没了)/.test(String(text || ''))) {
    return { emoKey: 'hurt', intensity: 0.65, note: '他家里出事了' }
  }
  // 笑死、乐死是乐，不是吓着
  if (/笑死|乐死|要笑死了/.test(String(text || ''))) {
    return { emoKey: 'joy', intensity: 0.4, note: '他被逗乐了' }
  }

  // 引用式提问：他嘴上带着情绪词，其实是在问她。
  // 「你怎么又气炸了」「你是不是难受」——以前会被自己的词点着，越问越气。
  if (/你怎么|你怎么又|你是不是|为啥|为什么|咋又/.test(String(text || ''))
      && /气|炸|火|崩|难受|委屈|怕|累|烦/.test(String(text || ''))) {
    return { emoKey: 'irritable', intensity: 0.2, note: '他在问她怎么了' }
  }

  // 先看这句在干什么，再看他的情绪。


  if (isPraise(String(text || '')).praise) {
    return { emoKey: 'joy', intensity: 0.45, note: '他在夸我' }
  }
  if (isBanter(String(text || '')).banter) {
    return { emoKey: 'irritated', intensity: 0.35, note: '他在闹，回一句嘴就行' }
  }

  // 极短的正常回话（在呢/好了/继续）不是"绷着"，是平静。
  // 之前被"短句+没标点=绷着"那条规则吃成 tense。
  {
    const s = String(text || '').trim()
    const n = [...s].length
    if (n <= 5 && !/不|没|别|他妈|操|草|滚|傻|崩|错/.test(s)) {
      return { emoKey: 'calm', intensity: 0, note: '' }
    }
  }


  // 麻木是"没什么起伏"的一种，别当成独立情绪往下传
  if (k === 'numb') return { emoKey: 'calm', intensity: 0, note: '' }
  if (k === 'calm' || i <= 0) return { emoKey: 'calm', intensity: 0, note: '' }

  // 闹着玩：他嘴上损我，我该回一句嘴，不是真生气、更不是委屈
  if (isBanter(String(text || '')).banter) {
    return { emoKey: 'irritated', intensity: 0.35, note: '他在闹，回一句嘴就行' }
  }

  const atMe = isAtHer(text)

  if (HOT.has(k)) {
    // 冲她来的火：她不是回火，是委屈加一点怕
    if (atMe) return { emoKey: 'hurt', intensity: Math.min(0.8, i * 0.9), note: '他在冲我发火' }
    // 冲别的事：跟着急，但比他低一档
    return { emoKey: 'angry', intensity: Math.min(0.7, i * 0.65), note: '他遇上事了，我跟着急' }
  }
  if (DOWN.has(k)) {
    return { emoKey: 'tender', intensity: Math.min(0.75, i * 0.8), note: '他不好受' }
  }
  if (UP.has(k)) {
    return { emoKey: 'joy', intensity: Math.min(0.8, i * 0.7), note: '他高兴' }
  }
  return { emoKey: k, intensity: i * 0.7, note: '跟着他' }
}
