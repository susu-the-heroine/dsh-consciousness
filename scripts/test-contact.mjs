/**
 * 接话：你说到这儿，我顺嘴提一句
 * ===========================
 *
 *   node scripts/test-contact.mjs
 *
 * 正面：问句里有三段同样的字、别处真有那条、不在结果里 → 接一句
 * 反面：问句太短不接、十分钟内只接一次、已经在结果里不接、没有对得上的不接、脏数据不炸
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/contact.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const L = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const { pickFollowUp } = await import(L + '/contact.js')

let pass = 0
let fail = 0
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')) }
}

const now = Date.UTC(2026, 10, 17, 12)
const data = {
  points: [
    { id: 1, title: '显卡画神经跑通了', text: '显卡画神经跑通了，GL星页能出星。' },
    { id: 2, title: '阑尾炎与洋葱圈', text: '打吊针，洋葱圈划舌头。' },
    { id: 3, title: '显卡那晚的压测', text: '一千二百点压测只有一帧。' },
  ],
}

const a = pickFollowUp('显卡那晚到底跑成什么样', data, [1], now, 0)
ok('有对得上的就接一句', /让我想起另一件/.test(a.line) && /压测/.test(a.line), a.line)

const b = pickFollowUp('显卡', data, [1], now, 0)
ok('问句太短不接', b.line === '', b.line)

const c = pickFollowUp('显卡那晚到底跑成什么样', data, [1, 3], now, 0)
ok('已经在结果里不接', c.line === '', c.line)

const d = pickFollowUp('显卡那晚到底跑成什么样', data, [1], now + 60 * 1000, a.at)
ok('十分钟内只接一次', d.line === '', d.line)

const e = pickFollowUp('今天天气不错出去转转', data, [], now, 0)
ok('对不上就不接', e.line === '', e.line)

const f = pickFollowUp(null, null, null, null, null)
ok('脏数据不炸', f.line === '' && typeof f.at === 'number')

console.log(`\n接话自测：通过 ${pass} · 失败 ${fail}`)
process.exit(fail ? 1 : 0)
