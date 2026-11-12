/**
 * 共情映射：他的情绪 → 她的反应
 * ============================
 * 起因：苏苏侠说「我真的气死我了，你每次都这样」，系统往外吐「她挺生气」。
 * 那是他的气，不是她的。人不是复制情绪，是回应情绪。
 *
 * 跑法：node test/empathy.test.mjs
 */
const BASE = new URL('../', import.meta.url).href
const { empathyOf, isAtHer } = await import(BASE + 'lib/empathy.js')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('\n共情映射：')

// 一、冲她来的火 → 她委屈，不是回火
const a = empathyOf({ emoKey: 'angry', intensity: 0.7 }, '我真的气死我了，你每次都这样')
ok(a.emoKey === 'hurt', '冲她发的火，她委屈而不是生气', a.emoKey)
ok(a.intensity > 0.4 && a.intensity <= 0.8, '强度有，但比她"直接复制"低', a.intensity)

// 二、冲别的事 → 跟着急，但低一档
const b = empathyOf({ emoKey: 'angry', intensity: 0.7 }, '这破电脑又崩了')
ok(b.emoKey === 'angry', '冲别的事，她跟着急', b.emoKey)
ok(b.intensity < 0.7, '跟着急要比他低', b.intensity)

// 三、他难受 → 她软
const c = empathyOf({ emoKey: 'sad', intensity: 0.6 }, '我今天难受死了')
ok(c.emoKey === 'tender', '他难受，她软下来', c.emoKey)

// 四、他高兴 → 她高兴
const d = empathyOf({ emoKey: 'joy', intensity: 0.65 }, '太好了终于过了')
ok(d.emoKey === 'joy', '他高兴，她跟着高兴', d.emoKey)

// 五、平静不该被造假情绪
const e = empathyOf({ emoKey: 'calm', intensity: 0 }, '随便聊聊')
ok(e.intensity === 0 && e.emoKey === 'calm', '平静就是平静，不硬造', e.emoKey + e.intensity)

// 六、判断"是不是冲她"
ok(isAtHer('你每次都这样'), '「你每次都这样」算冲她')
ok(isAtHer('你他妈又把地图弄没了'), '「你他妈」算冲她')
ok(!isAtHer('这破电脑又崩了'), '骂电脑不算冲她')
ok(!isAtHer('今天食堂的饭真难吃'), '骂饭不算冲她')

console.log('\n通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
