/**
 * 手滑语料生成器
 * =============
 * 依据《人话的不完美清单》十类，把干净句子弄脏。
 * 不是为了好看，是为了撞出识海的毛病。
 *
 * 用法：
 *   import { messy, CATEGORIES } from './messy.js'
 *   messy('我明天去市里找你', '删改残留')
 */
const TYPO_KEY = [
  ['没事', '木事'], ['等会', '等合'], ['知道了', '知到了'], ['好', '和'],
  ['在', '再'], ['的', '得'], ['做', '作'], ['哪', '那'], ['必', '比'],
  ['辩', '辨'], ['需', '须'], ['形式', '形势'], ['权利', '权力'],
]

const HOMOPHONE = [
  ['我没明白', '我每明白'], ['等一会', '等以会'], ['需要', '须要'],
  ['再见', '在见'], ['有的', '有得'], ['必须', '必需'],
]

const FILLER = ['害', '哎', 'emm', '额', '啧', '算了', '那个', '就是', '你懂吧']

const VAGUE = ['一会', '晚点', '差不多', '好几次', '一点点', '不久']

const pick = (arr, r) => arr[Math.floor(r() * arr.length)]

/** 十类配方 */
export const CATEGORIES = [
  '形近错字', '同音错字', '联想替换', '删改残留', '拼音简写',
  '漏字多字', '语序颠倒', '打一半断掉', '指代不清', '矛盾表达',
  '只留情绪', '跳话题', '情绪夸张', '反话', '叠句重复',
  '模糊量词', '双重否定', '没标点', '拆条发送', '表情代替',
]

export function messy(text, category, rnd = Math.random) {
  const t = String(text || '').trim()
  if (!t) return t
  const cut = (s, n) => [...s].slice(0, n).join('')
  switch (category) {
    case '形近错字': {
      const [a, b] = pick(TYPO_KEY, rnd)
      return t.includes(a) ? t.replace(a, b) : t + ' ' + b
    }
    case '同音错字': {
      const [a, b] = pick(HOMOPHONE, rnd)
      return t.includes(a) ? t.replace(a, b) : t
    }
    case '联想替换': {
      // 后半段被联想词顶掉
      const half = Math.floor([...t].length / 2)
      return cut(t, half) + pick(['喝茶', '有点麻烦', '吃药', '春游'], rnd)
    }
    case '删改残留': {
      // 新旧混在一句：原句 + 「不」+ 改后的半句
      return t + '，不' + t.slice(0, Math.max(2, Math.floor(t.length / 2)))
    }
    case '拼音简写': {
      const w = cut(t, 2)
      return w + pick(['wq', 'k', 'cy', 'bbl'], rnd) + cut(t.slice(2), 4)
    }
    case '漏字多字': {
      const i = Math.floor([...t].length / 2)
      return rnd() < 0.5
        ? cut(t, i) + cut([...t].slice(i + 1).join(''), 99)   // 漏一个字
        : t.slice(0, i) + '很很' + t.slice(i)                  // 叠字
    }
    case '语序颠倒': {
      const parts = t.split(/[，。！？]/).filter(Boolean)
      return parts.length > 1 ? parts.reverse().join('') : t.slice(2) + t.slice(0, 2)
    }
    case '打一半断掉':
      return cut(t, Math.max(3, Math.floor([...t].length * 0.55))) + pick(['，那个东', '……', '他', '我'], rnd)
    case '指代不清':
      return pick(['他', '那个东西', '它'], rnd) + pick(['不行', '搞定了', '还那样', '不好'], rnd)
    case '矛盾表达': {
      const neg = t.replace(/[，。]/g, '')
      return neg + '，不' + neg.slice(0, Math.max(2, Math.floor(neg.length / 2)))
    }
    case '只留情绪':
      return pick(['真的气死我了', '太难受了', '烦死了', '心里堵得慌', '算了不说了'], rnd)
    case '跳话题':
      return t + '，对了' + pick(['那个猫跑了', '充电器什么时候还', '你吃饭了吗', '我钥匙丢了'], rnd)
    case '情绪夸张':
      return t.replace(/我/g, '我').replace(/$/, '，每次都这样，从来都这样')
    case '反话':
      return t + '，可真厉害啊'
    case '叠句重复':
      return t + t + t
    case '模糊量词':
      return t.replace(/[。！？]?$/, '，') + pick(VAGUE, rnd) + '吧'
    case '双重否定':
      return t.replace(/[。！？]?$/, '') + '，不是不想不去'
    case '没标点':
      return t.replace(/[，。！？、；：]/g, '')
    case '拆条发送': {
      const chars = [...t]
      const step = Math.max(2, Math.ceil(chars.length / 3))
      const out = []
      for (let i = 0; i < chars.length; i += step) out.push(chars.slice(i, i + step).join(''))
      return out.join('\n')
    }
    case '表情代替':
      return pick(['🥺', '😤', '😂', 'emm', '。。'], rnd)
    default:
      return t
  }
}

/** 一次生成一批，覆盖所有类别 */
export function batch(seeds, perCategory = 3) {
  const out = []
  for (const c of CATEGORIES) {
    for (let i = 0; i < perCategory; i++) {
      const s = seeds[(i * 7 + c.length) % seeds.length]
      out.push({ text: messy(s, c), category: c, from: s })
    }
  }
  return out
}
