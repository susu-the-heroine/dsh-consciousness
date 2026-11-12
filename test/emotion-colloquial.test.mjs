/**
 * 口语情绪：人嘴里说的话，词表里得有
 * ==============================
 * 起因：拿脏输入撞情绪判定，十四句最普通的口语，八句被判成 calm 0——
 * 气死我了、想哭、吓死我了、真开心、火大、委屈、憋屈、崩溃，全没认出来。
 * 词表按书面语建的，人嘴里的话不在表里。
 *
 * 这个测试盯着两件事：口语要认得出；普通陈述别被误点燃。
 *
 * 跑法：node test/emotion-colloquial.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { judgeEmotion } = await import(BASE + 'lib/mood.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n口语情绪：')

const CASES = [
  ['气死我了', 'angry'],
  ['气炸了', 'angry'],
  ['火大', 'angry'],
  ['烦死了', 'angry'],
  ['想哭', 'sad'],
  ['鼻子酸', 'sad'],
  ['吓死我了', 'scared'],
  ['真开心', 'joy'],
  ['舒服死了', 'joy'],
  ['有点不舒服', 'sad'],
  ['委屈', 'sad'],
  ['憋屈', 'sad'],
  ['崩溃', 'dejected'],
  ['顶不住了', 'dejected'],
  ['难受', 'sad'],
  ['撑不住', 'dejected'],
  // 反话
  ['可真厉害啊', 'irritated'],
  // 极端概括（情绪宣泄，不是事实）
  ['你每次都迟到', 'angry'],
  ['你从来都不上心', 'angry'],
  ['他老是不回消息', 'angry'],
  ['从来都没说过', 'angry'],
]

for (const [t, want] of CASES) {
  const j = judgeEmotion(t, 15)
  ok(j.emoKey === want, '「' + t + '」→ ' + want, j.emoKey + ' ' + j.intensity)
}

// 强度别太软：气死我了 应该明显高于 0.4
const hot = judgeEmotion('气死我了', 15)
ok(hot.intensity >= 0.6, '气死我了 强度够', hot.intensity)

// 普通陈述不许被点燃
console.log('\n别误伤：')
for (const t of ['重启了', '继续', '好了', '今天吃了面', '明天上午上课', '锅糊了', '我在写代码']) {
  const j = judgeEmotion(t, 15)
  ok(j.intensity <= 0.5, '「' + t + '」不该被点燃', j.emoKey + ' ' + j.intensity)
}

// 已经判准的不能被口语层压掉（难受是 sad，不是被改成别的）
const keep = judgeEmotion('难受', 15)
ok(keep.emoKey === 'sad', '原本判得准的不被覆盖', keep.emoKey)

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
