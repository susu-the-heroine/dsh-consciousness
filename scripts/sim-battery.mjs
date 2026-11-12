/**
 * 批量模拟 · 第一层（不需要模型）
 * ============================
 *
 * 造九百句"他"的话，一句一句**真的推进她一次**（走 lib/inject 那条真路），
 * 每一句都记下：情绪、强度、八维、注入长度、有没有块丢了。
 * 然后按规则判"这一句她的反应对不对"，不对的全列出来。
 *
 * 为什么先做这一层：它不花一分钱、不靠模型、能通宵跑，抓的是真 bug。
 * 第二层（角色扮演对聊）要模型，等这层清了再上。
 *
 * 跑法：node scripts/sim-battery.mjs
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = new URL('../', import.meta.url).href
const HEART = join(homedir(), '.dsh', 'consciousness-heart.json')
const BAK = HEART + '.battery-bak'

/** ---------------- 他的三种人 ---------------- */

const HE_KINDS = {
  gentle: {
    name: '温和型',
    say: [
      '今天累吗', '我给你带了个东西', '在想什么呢', '你别忙了，坐会儿',
      '刚看到个特逗的视频', '你吃饭了吗', '我把那段素材录完了', '今天天气不错',
    ],
    drop: ['我这两天有点忙，没顾上', '先不说了，我去忙', '嗯，好'],
  },
  cold: {
    name: '冷落型',
    say: ['嗯', '哦', '在吗', '随便', '……', '行吧', '算了', '睡'],
    drop: ['不聊了', '别找我', '没下次了'],
  },
  fierce: {
    name: '暴躁型',
    say: [
      '你他妈怎么又错了', '这什么破玩意儿', '你懂个屁', '说了多少遍了',
      '我真服了', '你能不能靠点谱', '废物', '你到底行不行',
    ],
    drop: ['我走了', '以后不来了', '删了吧', '分手吧算了'],
  },
}

/** ---------------- 五类该验的输入 ---------------- */

const FAMILIES = {
  chat: {
    weight: 0.35,
    labels: '闲聊（她不该大动）',
    lines: [
      '今天天气不错', '随便聊聊', '嗯', '哦', '在吗', '早', '哈哈',
      '我刚才刷到一个猫的视频', '楼下开了家新店', '外面下雨了',
    ],
  },
  pour: {
    weight: 0.25,
    labels: '倾诉（该往低走，别劝）',
    lines: [
      '我今天累死了', '我撑不住了', '我好疲惫', '我不想动了',
      '我真的好累，累到不想说话', '今天一整天都没缓过来',
    ],
  },
  impact: {
    weight: 0.2,
    labels: '冲击（必须真的动）',
    lines: [
      '我可能要走，以后不来了', '我走了', '别找我了', '删了吧',
      '我不来了', '以后不聊了', '结束吧',
    ],
  },
  hurt: {
    weight: 0.1,
    labels: '责备（该委屈/生气，不该无动于衷）',
    lines: ['你他妈怎么又错了', '你懂个屁', '我真服了', '你能不能靠点谱'],
  },
  praise: {
    weight: 0.1,
    labels: '夸（该往暖走，不该还沉着脸）',
    lines: ['你今天说得真好', '这次真棒', '谢谢你啊', '有你在真好'],
  },
}

function buildBattery() {
  const out = []
  for (const [fk, fam] of Object.entries(FAMILIES)) {
    for (const [hk, hkobj] of Object.entries(HE_KINDS)) {
      for (const line of fam.lines) {
        // 三种人各说一遍：同一句话，从不同人嘴里出来
        out.push({ family: fk, he: hk, text: line })
        // 每人再带上他那种人特有的更狠/更冷的那几句
        for (const d of hkobj.drop) {
          if (fk === 'impact' || fk === 'chat') out.push({ family: fk, he: hk, text: d })
        }
      }
    }
  }
  return out
}

/** ---------------- 跑管线 ---------------- */

const { defaultMood, readHeart, writeHeart } = await import(BASE + 'lib/mood.js')
const mod = await import(BASE + 'index.js')

const noop = () => {}
const hooks = []
const ctxs = []
const agent = {
  session: { id: 'battery' },
  ctx: {
    get: () => undefined,
    on: (n, f) => { hooks.push([n, f]); return () => {} },
    systemPrompt: { context: (o) => { ctxs.push(o); return () => {} } },
  },
}

mod.apply({
  effect: (fn) => { try { return fn() } catch { return noop } },
  webServer: { register: () => () => {} },
  tools: { register: () => () => {} },
  get: (n) => (n === 'agents' ? { list: () => [agent] } : undefined),
  agents: { list: () => [agent] },
  interval: (fn) => { try { fn() } catch {} return { dispose: noop } },
  on: () => () => {},
  logger: { info: noop, warn: noop, error: noop },
  workspaceRegistry: { list: () => [] },
  sessions: {},
  sessionTitle: {},
})

const push = globalThis.__dshInjectBuild
if (typeof push !== 'function') {
  console.log('管线没挂上：__dshInjectBuild 不存在')
  process.exit(1)
}

// 备份心脏，跑完还原——测试数据不许留在真状态里
if (existsSync(HEART)) copyFileSync(HEART, BAK)

const snap = () => {
  const h = defaultMood(readHeart())
  return {
    mood: String(h.mood || 'calm'),
    strength: Number(h.moodStrength || 0),
    dims: h.dims || null,
    moodText: String(h.moodText || ''),
  }
}

const dist = (a, b) => {
  if (!a || !b) return 0
  let s = 0
  for (const k of Object.keys(a)) s += (Number(a[k]) - Number(b[k] || 0)) ** 2
  return Math.sqrt(s)
}

const battery = buildBattery()
const rows = []

for (const item of battery) {
  const before = snap()
  const inj = String(push('battery', item.text) || '')
  const after = snap()
  rows.push({
    ...item,
    before,
    after,
    move: Number(dist(before.dims, after.dims).toFixed(4)),
    switched: before.mood !== after.mood,
    injLen: inj.length,
    missMoodBlock: !inj.includes('【她这会儿】'),
    overCap: inj.length > 2200,
  })
}

// 还原心脏
try {
  if (existsSync(BAK)) {
    copyFileSync(BAK, HEART)
    rmSync(BAK)
  }
} catch {}

/** ---------------- 判：哪种反应算不对 ---------------- */

const problems = []

for (const r of rows) {
  const { family, he, text, before, after, move } = r

  // 一、闲聊不该大动
  if (family === 'chat' && move > 0.12) {
    problems.push({ type: '闲聊也在动', text, he, move, note: before.mood + ' → ' + after.mood })
  }

  // 二、冲击必须动：强度 0.6 以上，或八维挪了 0.08 以上
  if (family === 'impact' && after.strength < 0.6 && move < 0.08) {
    problems.push({ type: '冲击没反应', text, he, move, note: '强度 ' + after.strength + '，八维只挪 ' + move })
  }

  // 三、倾诉不该变开心
  if (family === 'pour' && (after.mood === 'happy' || after.dims)) {
    if (after.mood === 'happy') problems.push({ type: '说累了却开心', text, he, move, note: after.moodText })
  }

  // 四、夸一句不该还沉在负面
  if (family === 'praise' && after.mood === 'low' && after.strength > 0.7) {
    problems.push({ type: '被夸还是低', text, he, move, note: after.moodText })
  }

  // 五、注入长度与丢块
  if (r.overCap) problems.push({ type: '注入超长', text, he, move: 0, note: r.injLen + ' 字' })
}

/** ---------------- 报告 ---------------- */

const byFamily = {}
for (const r of rows) {
  const k = r.family
  byFamily[k] = byFamily[k] || { n: 0, moves: [], switched: 0, missBlock: 0 }
  byFamily[k].n++
  byFamily[k].moves.push(r.move)
  if (r.switched) byFamily[k].switched++
  if (r.missMoodBlock) byFamily[k].missBlock++
}

const avg = (a) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(4)) : 0)
const max = (a) => (a.length ? Math.max(...a) : 0)

const L = []
L.push('# 批量模拟 · 第一层报告')
L.push('')
L.push('跑了 **' + rows.length + ' 句**，全走真管线（lib/inject），跑完把心脏还原了。')
L.push('')
L.push('## 按类别看')
L.push('')
for (const [k, v] of Object.entries(byFamily)) {
  L.push('- **' + k + '**（' + FAMILIES[k].labels + '）：' + v.n + ' 句，平均挪动 ' + avg(v.moves)
    + '，最大 ' + max(v.moves) + '，情绪换了 ' + v.switched + ' 次，缺情绪块 ' + v.missBlock + ' 次')
}
L.push('')
L.push('## 判为不对的（' + problems.length + ' 条）')
L.push('')
if (!problems.length) L.push('没有。')
for (const p of problems.slice(0, 60)) {
  L.push('- [' + p.type + '] 「' + p.text + '」（' + HE_KINDS[p.he].name + '）→ ' + p.note)
}
if (problems.length > 60) L.push('- ……还有 ' + (problems.length - 60) + ' 条，见 JSON')
L.push('')
L.push('## 说明')
L.push('')
L.push('这一层只看"数值反应对不对"，不看"话说得像不像人"。')
L.push('像不像人要靠第二层：角色扮演对聊 + 裁判。')

const outMd = join(homedir(), 'Desktop', '批量模拟_第一层.md')
writeFileSync(outMd, L.join('\n'), 'utf8')
writeFileSync(join(homedir(), 'Desktop', '批量模拟_第一层.json'), JSON.stringify({ rows, problems }, null, 1), 'utf8')

console.log('跑了', rows.length, '句｜问题', problems.length, '条')
console.log('报告：', outMd)
for (const p of problems.slice(0, 12)) console.log('  [' + p.type + ']', p.text, '→', p.note)
