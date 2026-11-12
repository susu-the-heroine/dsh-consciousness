/**
 * 三十个角色 · 用真语料当种子
 * ==========================
 * 跟 agents30.mjs 的区别：**这里的每一条记忆都是从他的档案里原样搬来的**，
 * 不是我编的。角色不写人设，只写"他记着这几句"。
 *
 * 生成逻辑：从 ~/.dsh/记忆/*.md 里抽带原话的行，按关键词分三十组，每组六句。
 * 人格（基线+阻尼）按十五种轮流分配——那只是情绪底色，不参与文字。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MEM = join(homedir(), '.dsh', '记忆')

const PERSONAS = ['gentle', 'introvert', 'stubborn', 'sunny', 'gloomy', 'tsundere',
  'slacker', 'fiery', 'nostalgic', 'timid', 'detached', 'sensitive', 'hotblood', 'warmslow', 'selfdoubt']

/** 三十个主题：只用来分组，不是人设 */
const TOPICS = [
  ['抖音开头两秒', /两秒|开头|完播|跳出|标题/],
  ['播放与数据', /播放|一万|11000|25\.88|流量/],
  ['剪辑手法', /转场|J-Cut|卡点|蒙太奇|镜头|调色/],
  ['GMod 与素材', /GMod|ragdoll|模型|地图|空气墙|录制/],
  ['配音与声库', /配音|声库|念白|翻唱|嗓子|音色/],
  ['插件与报错', /插件|报错|崩溃|重启|代码|接口/],
  ['DSH 与工具', /DSH|子智能体|权限|C盘|命令行/],
  ['记忆与存档', /记忆|存档|上下文|遗忘|消失/],
  ['钱与底气', /房|路虎|国家电网|工资|豆荚|块钱/],
  ['累与腰', /累|腰|撑不住|熬夜|半夜/],
  ['吃与烟酒', /薯片|饭|披萨|吃|烟|酒/],
  ['家里与过去', /家|妈|爸|高中|学校|小的时候/],
  ['骂人与玩笑', /傻|他妈的|懂个屁|装逼|怼/],
  ['约定与承诺', /答应|承诺|说好|兑现|欠/],
  ['灵感与脑洞', /脑洞|想法|点子|创意|剧本/],
  ['自我怀疑', /不行|做不到|没用|无能|废物/],
  ['被认可', /夸|厉害|牛逼|佩服|厉害/],
  ['收拾残局', /崩了|又错|修|补救|重来/],
  ['别人怎么看', /别人|观众|评论|弹幕|群里/],
  ['时间与日期', /几点|日期|时间|昨天|前天|明天/],
  ['身体与疼', /疼|酸痛|手|眼睛|胃/],
  ['情绪与脾气', /生气|烦|火|急|憋/],
  ['安静与孤独', /安静|一个人|没人|孤独|睡不着/],
  ['习惯与规矩', /习惯|规矩|不许|别|必须/],
  ['打字与错字', /错字|痘印|剪影|输入法|空格/],
  ['笑与梗', /哈哈|笑|梗|搞|乐/],
  ['严肃的底线', /底线|原则|绝对|红线/],
  ['孩子与将来', /孩子|以后|将来|老了/],
  ['设备与硬件', /显卡|内存|硬盘|显示器|键盘/],
  ['一天的结尾', /收工|下班|回家|结束|最后/],
]

function collect() {
  const out = []
  for (const f of readdirSync(MEM)) {
    if (!f.endsWith('.md')) continue
    let t = ''
    try { t = readFileSync(join(MEM, f), 'utf8') } catch { continue }
    for (const raw of t.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim()
      if (line.length < 24 || line.length > 200) continue
      if (!/[「“]/.test(line)) continue
      if (/^\|/.test(line) || /^#{1,6}\s/.test(line)) continue
      out.push(line)
    }
  }
  return out
}

import { humanness } from '../lib/humanness.js'
const raw = collect()
// 种子先筛一遍：人味不到 0.65 的句子不要。
// 实测：夹具整体均分 0.792、86% 过 0.70；掉分的是少数不够实的替补句。
const corpus = raw.filter((line) => humanness(line).score >= 0.65)
if (corpus.length < 60) {
  // 筛太狠就放宽，别把夹具搞空
  corpus.push(...raw.filter((line) => !corpus.includes(line)).slice(0, 60))
}
const used = new Set()

export const AGENTS30 = TOPICS.map(([topic, re], i) => {
  const hits = corpus.filter((x) => !used.has(x) && re.test(x))
  const picked = hits.slice(0, 6)
  for (const p of picked) used.add(p)
  const pool = picked.length >= 3 ? picked : corpus.filter((x) => !used.has(x)).slice(0, 6)
  for (const p of pool) used.add(p)
  const memories = pool.map((line) => ({
    title: line.slice(0, 16),
    text: line.length >= 12 ? line : line + '，他一直记着',
  }))
  // 探测：拿一句真话里的六个字去问，期望翻回这一条
  const probes = pool.slice(0, 2).map((line) => {
    const t = line.slice(0, 16)
    const mid = line.slice(Math.max(0, Math.floor(line.length / 3)), Math.floor(line.length / 3) + 8)
    return { q: mid || t, expect: t }
  })
  return {
    name: String(i + 1).padStart(2, '0') + ' ' + topic + ' · ' + PERSONAS[i % PERSONAS.length],
    persona: PERSONAS[i % PERSONAS.length],
    story: '从他的档案里长出来的：' + topic,
    style: '（不写人设，只用真话）',
    quirks: '',
    badHabit: '', goodHabit: '', habit: '',
    thought: '记着就好。',
    memories,
    probes,
    seeded: true,
  }
})
