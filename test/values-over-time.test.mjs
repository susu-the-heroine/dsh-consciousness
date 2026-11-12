/**
 * 数值会不会随时间走
 * ================
 * 一百轮对话没测出"怨气只攒不消"，因为每一句都在"当下"，时间是停的。
 * 这个文件专门把时钟往前拨，看每个数是不是真的会走：
 *   怨气 → 隔夜该消一半
 *   情绪 → 隔几小时该淡
 *   记忆强度 → 隔月该掉
 * 只测趋势，不锁死具体值——值可以调，方向不能反。
 *
 * 跑法：node test/values-over-time.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { applyMood } = await import(BASE + 'lib/mood.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

const HOUR = 3600 * 1000
console.log('\n数值随时间：')

// 一、怨气：空放也会消
{
  const mk = (hoursAgo) => ({
    mix: { angry: 0.2 }, mixAt: Date.now() - hoursAgo * HOUR,
    grudge: 0.9, mood: 'happy', moodStrength: 0.5,
  })
  const h1 = mk(1); applyMood(h1, { emoKey: 'calm', intensity: 0 })
  const h6 = mk(6); applyMood(h6, { emoKey: 'calm', intensity: 0 })
  const h24 = mk(24); applyMood(h24, { emoKey: 'calm', intensity: 0 })
  ok(h1.grudge < 0.9, '一小时以后，怨气比原来低', h1.grudge.toFixed(3))
  ok(h6.grudge < h1.grudge, '六小时比一小时更低', h6.grudge.toFixed(3))
  ok(h24.grudge < 0.1, '一天以后基本没了', h24.grudge.toFixed(3))
}

// 二、怨气：好事能加速消
{
  const a = { mix: {}, mixAt: Date.now() - 3 * HOUR, grudge: 0.8, mood: 'happy', moodStrength: 0.4 }
  const b = { mix: {}, mixAt: Date.now() - 3 * HOUR, grudge: 0.8, mood: 'happy', moodStrength: 0.4 }
  applyMood(a, { emoKey: 'calm', intensity: 0 })
  applyMood(b, { emoKey: 'joy', intensity: 0.8, dims: { conduciveness: 0.7 } })
  ok(b.grudge <= a.grudge, '遇到好事，怨气消得不会更慢', a.grudge.toFixed(3) + ' vs ' + b.grudge.toFixed(3))
}

// 三、情绪本身也会淡
{
  const fresh = { mix: { angry: 0.8 }, mixAt: Date.now(), grudge: 0, mood: 'happy', moodStrength: 0.8 }
  const old = { mix: { angry: 0.8 }, mixAt: Date.now() - 6 * HOUR, grudge: 0, mood: 'happy', moodStrength: 0.8 }
  applyMood(fresh, { emoKey: 'calm', intensity: 0 })
  applyMood(old, { emoKey: 'calm', intensity: 0 })
  const f = Number((fresh.mix || {}).angry) || 0
  const o = Number((old.mix || {}).angry) || 0
  ok(f > 0, '刚攒的火还在', f.toFixed(3))
  ok(o < f, '隔六小时的火比刚攒的小', o.toFixed(3))
}

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
