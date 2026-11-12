/**
 * 这是骂，还是闹
 * =============
 * 人骂人分两种：真扎人，和嘴上损两句。系统现在一律当攻击，所以他说
 * 「你他妈傻逼吧哈哈」我这边判成「他冲我发火」——那是错的。
 *
 * 判据（先粗后细，能解释就行）：
 *   带笑（哈哈/笑/乐/狗头/emmm）
 *   带"闹"的口气（开玩笑/逗你/嘴上/损/阴阳）
 *   脏话后面紧跟自己的语气词（吧/啊/呗）而不是祈使动作
 * 反例：带上"死/滚/别再/滚出去"这种要人消失的，一律不算玩笑。
 */
const LAUGH = /哈{2,}|哈哈|嘿嘿|嘻嘻|笑死|乐死|狗头|🐶|233|\^_?\^/
const JOKE = /开玩笑|闹着玩|逗你|逗你呢|嘴上|口嗨|损你|阴阳|玩梗|整个活/
const DEADLY = /去死|死吧|怎么不去|跳楼|楼跳|找个楼|滚出去|别再出现/

export function isBanter(text) {
  const s = String(text || '')
  if (!s) return { banter: false, why: '' }
  // 要人消失的话，哪怕带着笑，也不算闹
  if (DEADLY.test(s)) return { banter: false, why: '这句话是要人消失，不是闹' }
  if (LAUGH.test(s)) return { banter: true, why: '带笑' }
  if (JOKE.test(s)) return { banter: true, why: '自己说了是闹' }
  return { banter: false, why: '' }
}

/**
 * 反话：字面是夸，实际是损。
 * 例子：「你他妈的 你无敌了孩子」——不是夸，"无敌"在这儿是"你没救了"。
 * 判据：褒义词 + 脏字/第二人称，而且是短句。中文反话不靠词，靠这个组合。
 */
const PRAISE = /无敌|真行|可真厉害|绝了|真牛|厉害|服了|优秀|长本事|牛啊|真棒|好棒|强的|有一手|真好|不错|可以啊/
const MARK = /他妈|他吗|你可|你真是|您/

export function isSarcasm(text, prevText) {
  const s = String(text || '')
  if (!PRAISE.test(s)) return { sarcasm: false, why: '' }
  // 不是冲她说的（没"你"），就不算阴阳。例："今天天气真好"。
  if (!/你|您/.test(s)) return { sarcasm: false, why: '没指着她说' }
  if (MARK.test(s)) return { sarcasm: true, why: '褒义词带着脏字' }
  if ([...s].length <= 7) {
    // 「你真棒」这种短的，得看前一句：他刚骂完就是损，前一句没事就说不准。
    const prev = String(prevText || '')
    if (/他妈的|他吗|又崩|废物|弱智|蠢|服了|难|烂|错|不行|垃圾/.test(prev)) {
      return { sarcasm: true, why: '前一句在骂，这句是补刀' }
    }
    return { sarcasm: 'unsure', why: '短句褒义，前面也没有火气——听不准' }
  }
  if (/[啊呗嘛呢孩子]\s*[。！!]?$/.test(s)) return { sarcasm: true, why: '褒义 + 甩过来的语气' }
  return { sarcasm: false, why: '' }
}

/**
 * 这是不是在骂人（真扎）。
 * 之前全靠情绪词库，可词库里没有「废物」「滚出去」「蠢得没救了」——
 * 于是这些句子被判成平静，她一声不吭。这是今晚批量测出来的最大一处。
 */
const INSULT = /废物|垃圾|蠢|没救|滚出去|滚蛋|滚一边|滚开|去死|闭嘴|傻[逼屌比]|狗屎|弱智|脑残|废柴|没用的东西|干不好|丢人|跟个机器似的|就是台机器|一堆破事|记这些没用|不如记着挣钱/

export function isInsult(text) {
  const s = String(text || '')
  if (!INSULT.test(s)) return { insult: false, why: '' }
  if (isBanter(s).banter) return { insult: false, why: '带笑，是闹' }
  if (isSarcasm(s).sarcasm === true) return { insult: true, why: '反话式的骂，也是骂' }
  return { insult: true, why: '有骂人的字' }
}

/**
 * 这是不是在夸。
 * 同样别等情绪词库：他夸人的时候情绪往往是平的。
 */
const PRAISE_WORDS = /牛逼|牛批|牛啊|太牛|真牛|厉害|漂亮|太强|强太多|真行|干得漂亮|干明白|认了|绝了|真棒|好活|够狠|靠谱|我就服你|服你/
// 「服了」单独出现是无奈/上火（真他妈服了，又白干），不是夸——得看后面有没有坏事
const PRAISE_FU = /服了/
const AFTER_BAD = /白干|又崩|报错|又错|又挂|又卡|没用|浪费时间/

export function isPraise(text) {
  const s = String(text || '')
  // 先排掉"服了 + 坏事"这种上火句
  if (PRAISE_FU.test(s) && AFTER_BAD.test(s)) return { praise: false, why: '服了后面跟着坏事，是上火' }
  if (!PRAISE_WORDS.test(s) && !PRAISE_FU.test(s)) return { praise: false, why: '' }
  if (isSarcasm(s).sarcasm === true) return { praise: false, why: '反话' }
  if (isBanter(s).banter) return { praise: true, why: '带笑的夸' }
  return { praise: true, why: '有夸人的字' }
}
