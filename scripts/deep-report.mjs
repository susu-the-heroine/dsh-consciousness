/**
 * 深度自测汇总：把每轮的判定和体检结果拼成一份缺陷清单。
 *
 * 输入：
 *   ~/.dsh/deep-verdict.jsonl   复核员判的（答非所问 / 复述注入 / 情绪贴不贴 / 跟没跟改口 / 回指）
 *   ~/.dsh/deep-surface.jsonl   体检员跑接口的（页面大小、心跳、沉底、语音、隔离）
 * 用法：node scripts/deep-report.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const D = join(homedir(), '.dsh')
function load(name) {
  const p = join(D, name)
  if (!existsSync(p)) return []
  const out = []
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.replace(/^\uFEFF/, '').trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch {}
  }
  return out
}

const v = load('deep-verdict.jsonl')
const s = load('deep-surface.jsonl')
if (!v.length && !s.length) {
  console.log('还没有深度测试结果。')
  process.exit(0)
}

const judged = v.filter((x) => typeof x.offtopic === 'boolean')
const cnt = (k) => judged.filter((x) => x[k] === true).length
const rate = (n) => judged.length ? (n / judged.length * 100).toFixed(1) + '%' : '-'

console.log(`判定 ${judged.length} 轮｜覆盖 ${new Set(judged.map((x) => x.test)).size} 次测试`)
console.log(`  答非所问 ${cnt('offtopic')} (${rate(cnt('offtopic'))})`)
console.log(`  复述注入 ${cnt('parrot')} (${rate(cnt('parrot'))})`)
console.log(`  情绪不贴 ${judged.filter((x) => x.moodFit === false).length}`)
const changed = judged.filter((x) => x.followedChange !== null && x.followedChange !== undefined)
console.log(`  改口没跟上 ${changed.filter((x) => x.followedChange === false).length}/${changed.length}`)
const recall = v.filter((x) => /recall=/.test(String(x.why || '')))
console.log(`  回指：ok ${recall.filter((x) => /recall=ok/.test(x.why)).length} / broken ${recall.filter((x) => /recall=broken/.test(x.why)).length}`)

if (s.length) {
  const leaks = s.filter((x) => x.leak === true)
  const badVoice = s.filter((x) => Number(x.voice) !== 400)
  const speakFail = s.filter((x) => !/没字可念|ok/.test(String(x.speak || '')))
  console.log(`\n体检 ${s.length} 次`)
  console.log(`  沙箱串了真库：${leaks.length}`)
  console.log(`  语音通道没挡住非法名：${badVoice.length}`)
  console.log(`  /speak 空字异常：${speakFail.length}`)
  const pages = s.map((x) => Number(x.page)).filter(Boolean)
  if (pages.length) console.log(`  页面大小：最小 ${Math.min(...pages)} / 最大 ${Math.max(...pages)}`)
}

console.log('\n报数规矩：问题按条列，别只报比例。')
