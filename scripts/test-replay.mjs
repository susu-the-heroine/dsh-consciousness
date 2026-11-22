/**
 * 历史查询回放 · 正反自测
 *
 * 正：老的第一名还在前三，算稳；统计和耗时都出得来。
 * 反：老的第一名掉出前三，必须算「不稳」，并进掉出清单。
 * 另验：日志解析要丢掉坏行和非检索行。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-21：按当前目录找库——换个目录跑就断在 file:///C:/lib/replay.js。改成按本文件位置。
const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = 'file:///' + join(HERE, '..', 'lib').replace(/\\/g, '/')
const R = await import(LIB + '/replay.js')

let ok = 0
let bad = 0
const t = (name, cond, note = '') => {
  if (cond) { ok++; console.log('  通过  ' + name) } else { bad++; console.log('  失败  ' + name + (note ? ' → ' + note : '')) }
}

// 解析：好行留、坏行丢、判注行丢、空 top 丢
const text = [
  JSON.stringify({ k: 's', q: '问一的甲', top: [{ id: 7, t: '问一的甲' }] }),
  'not json',
  JSON.stringify({ k: 'j', q: '问一', v: 'hit' }),
  JSON.stringify({ k: 's', q: '', top: [{ id: 8 }] }),
  JSON.stringify({ k: 's', q: '问二的乙', top: [] }),
  '',
].join('\n')
const parsed = R.parseLogLines(text)
t('解析只留有效检索行', parsed.length === 1, String(parsed.length))
t('解析保住原问句', parsed[0] && parsed[0].q === '问一的甲')

const entries = [
  { q: '问一的甲', sea: 'main', top: [{ id: 7, t: '问一的甲' }] },
  { q: '问二的乙', sea: 'main', top: [{ id: 9, t: '问二的乙' }] },
]

// 正：第一名还在前三
const good = await R.replay(entries, async (q) => ({ ids: q === '问一的甲' ? [7, 2, 3] : [1, 9, 4], ms: 12 }))
t('第一名在首位算稳', good.stable === 1, JSON.stringify(good.moved))
t('回放条数对', good.n === 2, String(good.n))
t('耗时中位出得来', good.p50 === 12, String(good.p50))

// 反：第一名掉到第四，必须判不稳
const badRun = await R.replay([entries[0]], async () => ({ ids: [1, 2, 3, 7], ms: 9 }))
t('掉出前三判不稳', badRun.stable === 0, JSON.stringify(badRun.rows))
t('掉出清单有它', badRun.moved.length === 1 && badRun.moved[0].want === 7)

// 反：搜都搜不出来，也算不稳
const gone = await R.replay([entries[1]], async () => ({ ids: [], ms: 5 }))
t('搜索无结果判不稳', gone.stable === 0)
t('无结果时排名记 0', gone.rows[0].rank === 0, String(gone.rows[0].rank))

// 反：searchFn 抛错，不许把整批打挂
const errRun = await R.replay(entries, async () => { throw new Error('boom') })
t('抛错不打挂整批', errRun.n === 2 && errRun.stable === 0, JSON.stringify(errRun))

console.log(`历史回放：通过 ${ok} · 失败 ${bad}`)
process.exit(bad ? 1 : 0)
