/**
 * ghost-test 的子进程：跑一遍计数，只输出一行 JSON
 * 开关由父进程通过环境变量给（C2_GHOST_REFUSE）。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const T = await import('file:///' + join(HERE, '..', 'lib', 'tools.js').replace(/\\/g, '/') + '?v=' + Date.now())

const fake = [
  '他养的那只蜥蜴叫什么', '他去年去冰岛住的哪家酒店', '他外婆家的门牌号',
  '他那把吉他是哪年买的', '他第一次潜水是在哪片海', '他办公室的绿萝谁送的',
]
const real = [
  '那条一万三播放的作品叫什么', '他家那条全国最长的城市主干道', '哪些话绝对不能对你说',
  '你第一次叫我名字是什么感觉', '他给短视频留的那句「不痛」',
]

// 2026-11-21：这里十一问都没带「不强化」——实测跑一次，真库的想起次数
// 从 105238 涨到 105350（多了一百一十二）。测试在改他的库，这是硬错。
// 加 review:false：只读，不写强化。
const said = async (q) => {
  const r = await T.searchTool.execute({ sea: 'main', query: q, review: false })
  return /没记过/.test(String((r && r.log) || ''))
}

let fakeRefused = 0
for (const q of fake) if (await said(q)) fakeRefused++
let realRefused = 0
for (const q of real) if (await said(q)) realRefused++

console.log(JSON.stringify({ fakeRefused, realRefused }))
