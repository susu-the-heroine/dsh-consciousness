/**
 * 语气 lint：扫「给人看的话」里还有多少机器腔
 * ==========================================
 *   node scripts/lint-human-voice.mjs          只看汇总
 *   node scripts/lint-human-voice.mjs --list   把每一条点名
 *
 * 判据来自 docs/语气规矩.md 的三条禁令：
 *   一、露内部结构（data.json、字段、参数、索引、向量、阈值、锁、缓存、镜像…）
 *   二、自说自话解释机制（「这条为什么被拒」这类说明书腔）
 *   三、把动作写成播报（已写入、已标记、已同步、已合并…）
 *
 * 只扫 lib/*.js 里带中文的字符串；注释不算。
 * 退出码：有命中就是 1，干净是 0，方便以后挂进自检。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const LIB = join(ROOT, 'lib')

// 一、露内部结构
const STRUCT = ['data.json', '字段', '参数', '索引', '向量', '阈值', 'revision', '入库', '句柄', 'JSON', '数据库', '线程', '缓存', '镜像', '校验', '条目', '连边', 'ID ', 'id：']
// 二、说明书腔（解释自己怎么运作）
const EXPLAIN = ['这条为什么', '因为这条', '本接口', '该字段', '此参数', '说明：', '注意：这条']
// 三、播报腔
const BROADCAST = ['已写入', '已标记', '已同步', '已合并', '已读取', '已更新', '已生成', '执行成功', '操作成功', '保存成功']

const rules = [
  ['露结构', STRUCT],
  ['说明书', EXPLAIN],
  ['播报', BROADCAST],
]

const isComment = (s) => /^\s*(\/\/|\*|\/\*)/.test(s)
// 只看引号里那段字，不看整行——不然 JSON.stringify 这种代码词也会被算成「露结构」。
const chineseLiterals = (s) => {
  const out = []
  const re = /'([^']*)'|"([^"]*)"|`([^`]*)`/g
  let m
  while ((m = re.exec(s))) {
    const t = m[1] || m[2] || m[3] || ''
    if (/[\u4e00-\u9fa5]/.test(t)) out.push(t)
  }
  return out
}

// 给修库的人看的（不是用的人）：镜像是修复工具，说 data.json 反而有用。
const DEV_ONLY = ['mirror-export.js', 'mirror-import.js']

let devLeft = 0
const rows = []
for (const f of readdirSync(LIB)) {
  if (!f.endsWith('.js')) continue
  const devOnly = DEV_ONLY.includes(f)
  const lines = readFileSync(join(LIB, f), 'utf8').split('\n')
  lines.forEach((line, i) => {
    const s = line.trim()
    if (!s || isComment(s)) return
    const lits = chineseLiterals(s)
    if (!lits.length) return
    const hits = []
    for (const [tag, words] of rules) {
      const w = []
      for (const t of lits) for (const x of words) if (t.includes(x) && !w.includes(x)) w.push(x)
      if (w.length) hits.push(tag + ':' + w.join('/'))
    }
    if (hits.length && devOnly) { devLeft++; return }
    if (hits.length) rows.push({ loc: f + ':' + (i + 1), hits: hits.join(' '), text: lits.join(' | ').slice(0, 120) })
  })
}

// 页面也算「给人看的话」：只扫引号里的字，且放过诊断页里那条接口路径。
const ASSETS = join(ROOT, 'assets')
let pageLeft = 0
try {
  for (const f of readdirSync(ASSETS)) {
    if (!f.endsWith('.html')) continue
    const lines = readFileSync(join(ASSETS, f), 'utf8').split(String.fromCharCode(10))
    lines.forEach((line, i) => {
      const s = line.trim()
      if (!s || isComment(s) || s.includes('consciousness/vector')) return
      for (const t of chineseLiterals(s)) {
        const w = []
        for (const [tag, words] of rules) for (const x of words) if (t.includes(x) && !w.includes(x)) w.push(x)
        if (w.length) { pageLeft++; rows.push({ loc: f.replace('.html', '页') + ':' + (i + 1), hits: w.join('/'), text: t.slice(0, 100) }) }
      }
    })
  }
} catch {}

const byTag = { 露结构: 0, 说明书: 0, 播报: 0 }
for (const r of rows) for (const k of Object.keys(byTag)) if (r.hits.includes(k)) byTag[k]++

console.log('  给人看的话里还剩机器腔：' + rows.length + ' 条')
console.log('  露结构 ' + byTag['露结构'] + ' · 说明书 ' + byTag['说明书'] + ' · 播报 ' + byTag['播报'] + '（另有 ' + devLeft + ' 条是给修库的人看的，留着）')

const list = process.argv.includes('--list')
if (list) for (const r of rows) console.log('    ' + r.loc + '  [' + r.hits + ']  ' + r.text)
else console.log('  （要逐条看就加 --list）')

writeFileSync(join(ROOT, 'docs', '人话审计.txt'), rows.map((r) => '[' + r.hits + '] ' + r.loc + '  ' + r.text).join('\n'), 'utf8')
console.log('  清单写进 docs/人话审计.txt')
process.exit(rows.length ? 1 : 0)
