// 假库验收：一个普通用户的十条，跟"咱俩"彻底无关。
// 跑法：node scripts/test-neutral.mjs
// 2026-11-11 立：规矩要给别人用，就得在没有咱俩的库上验一遍。
import { pickPairs } from '../lib/synth.js'
import { applyWordGate, rescueScan, contentWords } from '../lib/gate.js'

const D = 86400000
const pts = [
  { id: 1, title: '周一例会纪要', text: '会上定了三季度预算要走审批，财务说超两万要总监签字。', entities: ['预算', '财务'], category: ['工作'], imp: 0.6, arousal: 4, born: Date.now() - D * 30 },
  { id: 2, title: '地铁末班车', text: '那天下班晚了，末班车刚好赶上，车厢里只有三个人。', entities: ['地铁'], category: ['生活'], imp: 0.4, arousal: 3, born: Date.now() - D * 20 },
  { id: 3, title: '猫把杯子推下去了', text: '凌晨猫在桌上把马克杯推下去，碎了，我扫了半小时。', entities: ['猫'], category: ['生活'], imp: 0.5, arousal: 5, born: Date.now() - D * 10 },
  { id: 4, title: '预算还是被砍了', text: '会上说好的预算，第二轮被砍掉三成，财务只认总监的口头批复。', entities: ['预算', '财务'], category: ['工作'], imp: 0.8, arousal: 6, born: Date.now() - D * 2 },
  { id: 5, title: '学做红烧肉', text: '第一次做红烧肉，糖色炒糊了，整锅发苦。', entities: ['做饭'], category: ['生活'], imp: 0.4, arousal: 3, born: Date.now() - D * 15 },
  { id: 6, title: '和同事吵了一架', text: '他当着别人面把锅推给我，我没忍住，当着组里人怼回去。', entities: ['同事'], category: ['工作', '情绪'], imp: 0.7, arousal: 7, born: Date.now() - D * 5 },
  { id: 7, title: '猫又吐了', text: '第三天吐了两次，带去医院说是毛球，开了化毛膏。', entities: ['猫'], category: ['生活'], imp: 0.5, arousal: 5, born: Date.now() - D * 8 },
  { id: 8, title: '跑步五公里', text: '第一次跑进三十分钟，膝盖有点疼。', entities: ['跑步'], category: ['生活'], imp: 0.4, arousal: 5, born: Date.now() - D * 12 },
  { id: 9, title: '为什么总在推锅', text: '我发现每次出事，组里的第一反应不是查原因，是找人背。', entities: ['同事'], category: ['工作'], imp: 0.8, arousal: 6, born: Date.now() - D * 3 },
  { id: 10, title: '猫抓坏沙发', text: '新沙发被抓了三道口子，只能贴胶带。', entities: ['猫'], category: ['生活'], imp: 0.3, arousal: 2, born: Date.now() - D * 6 },
]

console.log('=== 合成挑对子 ===')
for (const p of pickPairs(pts, { n: 5 })) console.log(' -', p.why, '|', p.a.title, '×', p.b.title)

console.log('=== 词闸 ===')
const show = (q) => {
  const kept = applyWordGate(pts.map((p) => ({ p, score: 1 })), q, pts)
  console.log('问「' + q + '」实词', JSON.stringify(contentWords(q)), '→', kept.map((x) => x.p.title).join(' / ') || '(空)')
}
show('预算 财务')
show('猫')
show('猫 沙发')
show('那次吵架')

console.log('=== 兜底直扫 ===')
console.log('「吵架」直扫:', rescueScan(pts, '吵架').map((x) => x.p.title).join(' / ') || '(空)')
