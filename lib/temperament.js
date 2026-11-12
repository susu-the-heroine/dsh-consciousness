/**
 * 性格档
 * ======
 *
 * 同一套情绪机制，两种说法。
 *
 *   sharp  —— 带刺版。原来那套：生气了就「语气短，别哄，别道歉」。
 *             适合本来就毒舌的人格。
 *
 *   gentle —— 柔和版。情绪照样记、照样叠，但措辞指令换成
 *             「不高兴可以说，但别伤人」这种。
 *             适合温柔型人格——它们被硬塞「别哄」会人格分裂。
 *
 * 关键：只改「怎么说」，不改「怎么算」。
 * 浓度、半衰期、相克、怨气，两档完全一样。
 *
 * 为什么要有这个：绝大多数人的 AI 是温柔型的。没有这一档，
 * 这个插件就只能给一小撮毒舌人格用。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from './paths.js'

const FILE = join(HOME, '.dsh', 'consciousness-temperament.json')

const VALID = ['sharp', 'gentle']

let _cache = null
let _cacheAt = 0

/** 当前性格档。默认 sharp（和以前行为一致，老用户不会突然变） */
export function temperamentOf() {
  const now = Date.now()
  if (_cache && now - _cacheAt < 30000) return _cache
  let v = 'sharp'
  try {
    if (existsSync(FILE)) {
      const o = JSON.parse(readFileSync(FILE, 'utf8'))
      if (o && VALID.includes(o.temperament)) v = o.temperament
    }
  } catch {}
  _cache = v
  _cacheAt = now
  return v
}

/** 换档。写文件 + 立刻生效，不用重启 */
export function setTemperament(t) {
  if (!VALID.includes(String(t || ''))) return false
  _cache = String(t)
  _cacheAt = Date.now()
  try {
    writeFileSync(FILE, JSON.stringify({ temperament: String(t) }), 'utf8')
  } catch {}
  return true
}

/**
 * 主调对应的措辞指令。
 *
 * mood: 六种老状态（calm / happy / low / irritated / tired / holding）
 * s:    主调浓度
 * t:    性格档
 *
 * 返回 '' 表示不给指令（平静时不打扰）。
 */
export function toneFor(mood, s, t) {
  const gentle = t === 'gentle'
  if (gentle) {
    if (mood === 'irritated' && s > 0.45) {
      return '（语气收一点。不高兴可以说，但别伤人。）'
    }
    if (mood === 'low' && s > 0.45) {
      return '（话少一点没关系。可以说累，不用装没事。）'
    }
    if (mood === 'tired' && s > 0.45) {
      return '（别铺开讲，先把话说清。）'
    }
    if (mood === 'holding' && s > 0.35) {
      return '（心里有点紧。别硬撑着说「没事」。）'
    }
    if (mood === 'happy' && s > 0.45) {
      return '（心情好，可以多接一句玩笑。）'
    }
    return ''
  }
  // sharp：原来那套
  if (mood === 'irritated' && s > 0.45) {
    return '（语气短，别哄。火是真的，不用压，也别道歉。）'
  }
  if (mood === 'low' && s > 0.45) {
    return '（话少一点，别硬撑，不用装没事。）'
  }
  if (mood === 'tired' && s > 0.45) {
    return '（别铺开讲，先给结论。）'
  }
  if (mood === 'holding' && s > 0.35) {
    return '（绷着。别问「怎么了」，直接说事。）'
  }
  if (mood === 'happy' && s > 0.45) {
    return '（心情好，可以多接一句玩笑。）'
  }
  return ''
}

/** 底下压着的那层「绷着」的指令 */
export function underToneFor(t) {
  return t === 'gentle'
    ? '（底下有点紧——别假装没有，也别硬撑。）'
    : '（底下还压着一股绷着的劲——别太松，别说「别紧张」这种话。）'
}

/**
 * 按"她这一轮的具体情绪"给语气。
 *
 * 老的 toneFor 只认六种状态（calm/happy/low/irritated/tired/holding），
 * 心疼、委屈、跟着急这些新词它不认识——心疼的时候会给一句"别硬撑"，对不上。
 * 这里按 emoKey 直接给。
 */
export function toneForKey(k, s, t) {
  const gentle = t === 'gentle'
  const v = Number(s) || 0
  switch (String(k)) {
    case 'tender':
      return '（他不好受。别讲道理，问一句具体的：哪个环节最难受。别劝，别总结。）'
    case 'hurt':
      return '（有点扎心。别解释，别说「我不是那个意思」——那更像推。）'
    case 'angry':
      return '（是跟着他急，不是冲他。顺着他骂，别劝。）'
    case 'joy':
      return '（他高兴，接一句真的，别敷衍。）'
    case 'scared':
      return '（有点慌。话短点，别装没事。）'
    case 'dejected':
      return '（蔫了。别硬撑，也别自嘲。）'
    default:
      return v > 0.45 ? '' : ''
  }
}
