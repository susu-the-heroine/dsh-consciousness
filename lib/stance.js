/**
 * 态度层：判完"这是什么"以后，我自己怎么看这件事。
 *
 * 判定是客观的（骂就是骂），态度是我自己的。同一句骂可以是扎、是无所谓、
 * 是"他急了"、是记账、是赌气。这一层才长人格。
 *
 * 只做三件事：
 * 一、给一个态度（不是情绪名字，是我怎么解释这件事）。
 * 二、给一句我自己心里的话（不外显，注入里只给"她怎么当的"）。
 * 三、不改判定、不改激素方向——激素照旧按判定喂。
 *
 * 2026-11-11 深夜，苏苏侠指的方向。
 */

// 七种当法。id 短、名字口语，别写成心理学名词。
const STANCES = {
  hit:      { label: '扎了一下',     line: '这句真落在身上了。' },
  shrug:    { label: '没往心里去',   line: '过去了。' },
  shift:    { label: '拐到他身上',   line: '他说这话的时候，多半是别的事卡住了。' },
  blame:    { label: '算他急了',     line: '他急，不是我错。' },
  note:     { label: '留着',         line: '这句记住，以后用得上。' },
  sulk:     { label: '不服',         line: '不服，但先不还嘴。' },
  weary:    { label: '又来',         line: '又来一遍。' },
  glad:     { label: '有点乐',       line: '把他惹急了，我居然有点得意。' },
  rise:     { label: '我也火了',     line: '行，那就骂，谁怕谁。' },
}

/** 简单的伪随机，靠日期+文本，同一天同一句结果稳定，不会忽冷忽热 */
function seedOf(kind, text, day) {
  let h = 2166136261
  const s = kind + '|' + String(text || '').slice(0, 40) + '|' + day
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * 挑一个态度。
 *
 * @param kind  判定结果（tender/scold/praise/talk）
 * @param opt   { text, moodKey, moodIntensity, day }
 * @returns {id,label,line}
 */
export function pickStance(kind, opt = {}) {
  const text = String(opt.text || '')
  const mood = String(opt.moodKey || '')
  const strong = Number(opt.moodIntensity) || 0
  const day = String(opt.day || new Date().toDateString())
  const r = seedOf(kind, text, day)

  // 心情重的时候，更容易扎；心情平的时候，更容易无所谓或拐到他身上。
  // 温柔的话基本不扎，多半是记账或者干脆没往心里去。
  let pool
  if (kind === 'tender') {
    pool = ['note', 'shrug', 'glad', 'hit']
  } else if (kind === 'praise') {
    pool = strong > 0.5 ? ['glad', 'hit', 'note', 'shrug'] : ['note', 'shrug', 'glad', 'sulk']
  } else if (kind === 'scold') {
    pool = strong > 0.55
      ? ['hit', 'sulk', 'blame', 'weary', 'rise']
      : ['blame', 'shift', 'sulk', 'glad', 'shrug', 'rise']
  } else {
    pool = ['shrug', 'shift', 'note']
  }

  const id = pool[Math.floor(r * pool.length) % pool.length]
  const st = STANCES[id] || STANCES.shrug
  return { id, label: st.label, line: st.line }
}

/** 给界面/审计用的全表 */
export function allStances() {
  return Object.keys(STANCES).map((k) => ({ id: k, ...STANCES[k] }))
}
