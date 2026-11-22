/**
 * AI 味扫描（第一条可测的尺子）
 * ==============================
 *   node scripts/ai-smell.mjs [文件] [文件2 ...]
 *
 * 不判「像不像人」——那题没答案（反证：两边都是真人，评者照样挑出 6/10 与 9/10）。
 * 只数八种具体的 AI 味，每种都能指出来在哪：
 *   1 汇报腔：我+动词+数字（我跑了 / 我改了 / 我撤了 / 我量了 …）
 *   2 总结腔：总的来说 / 一句话 / 综上 / 归根到底
 *   3 对称排比：这是…不是… / 既能…又能… / 不仅…而且…
 *   4 术语堆：口径 条目 评者 题面 护栏 种子 流水 回滚 归因 维度
 *   5 解释自己：我是说 / 也就是说 / 换句话说 / 我解释一下
 *   6 汉字数字：七五零 / 一百二十二（人敲 7 5 0 / 122）
 *   7 话永远说圆：主语完整 + 动词完整 + 结尾完整（无省略、无倒装、无半句）
 *      （原来那条「标点太齐」已删：他要标点照用，见文件里那把锁）
 *
 * 输出：每条命中的味道、总命中率、按味道的占比。数字越小越好。
 */
import { readFileSync, existsSync } from 'node:fs'

const SMELLS = [
  ['汇报腔', /我\s*(跑了|改了|撤了|量了|杀了|补了|删了|加上|回滚|换成|试过|查过|记下)/],
  ['总结腔', /总的来说|整体来看|一句话|综上|归根到底|说到底|说白了|总结一下|可见|说明[^，。]{0,10}(对|不统一)|这是方法|方法论|该等的时候|这东西就得/],
  // 排比单独不算 AI 味（实测 6/10、3 平）；要配上空评价才露
  ['排比+空话', /(既[^，。]{1,15}又|不是[^，。]{1,15}而是|不仅[^，。]{1,15}(更|而且))[^。]{0,30}(更像人|伤信任|标准不齐|方向[对不]|方法论|意义|闭环|升级)/],
  // 术语单蹦一个不算味（他真会聊技术），一句话里堆到两个以上才算
  ['术语堆', (() => { const re = /口径|条目|评者|题面|护栏|种子|流水|回滚|归因|维度|字段|接口/g; return { test: (t) => (t.match(re) || []).length >= 2 } })()],
  ['解释自己', /我是说|也就是说|换句话说|我解释一下|我的意思是/],
  // 只抓「七五零／一百二十二」这类连写数字，别抓「一两个」这种口语
  ['汉字数字', /[零一二三四五六七八九]{3,}|[一二三四五六七八九][十百千][一二三四五六七八九十]?[零一二三四五六七八九]/],
  // 标点那条整个删掉：苏苏侠说「不加标点根本看不清 差评」——可读性高于这条形式
  // 说圆：整句收在句号上，且带因果/递进/完成态——评者点名的书面闭合感
  // 「话说太圆」已删：它抓的是「主谓完整+句号」，等于把标点禁令换个皮。他要标点照用。
]

// 锁：标点不许偷偷加回来。苏苏侠说「不加标点根本看不清 差评」，可读性高于形式。
// 谁想加「标点太齐」「句末别点」这类规则，先删掉这三行并写清为什么。
if (SMELLS.some(([name]) => /标点/.test(name))) {
  console.error('  不许把标点规则加回来：苏苏侠要的是能看清的字，不是空格断句。')
  process.exit(2)
}

const hit = (t) => SMELLS.filter(([, re]) => (typeof re === 'function' ? re.test(t) : re.test(t))).map(([n]) => n)

const files = process.argv.slice(2).filter((f) => existsSync(f))
if (!files.length) { console.log('  用法：node scripts/ai-smell.mjs <文件> [文件2]'); process.exit(1) }

for (const f of files) {
  // 支持两种输入：编号句（评测集）／裸文本（我自己写的回复，一行一句）
  const raw = readFileSync(f, 'utf8')
  const numbered = raw.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim())
  const lines = numbered.length ? numbered : raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (!lines.length) { console.log('  ' + f + '：没找到编号句子'); continue }
  const res = lines.map(hit)
  const withSmell = res.filter((r) => r.length > 0).length
  if (process.env.VERBOSE === '1') {
    console.log('    命中：' + res.map((r, i) => (r.length ? (i + 1) : '')).filter(Boolean).join(','))
  }
  const counts = {}
  res.forEach((r) => r.forEach((n) => { counts[n] = (counts[n] || 0) + 1 }))
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])
  console.log('\n  ' + f.split(/[\\/]/).pop() + '：' + lines.length + ' 条 · 带 AI 味 ' + withSmell + '（' + (withSmell / lines.length * 100).toFixed(0) + '%）')
  console.log('    ' + (top.length ? top.map(([n, c]) => n + '×' + c).join('  ') : '（干净）'))
}
