/**
 * 合成库换词测（跟咱俩的内容无关）
 * ================================
 *   node scripts/eval-synth.mjs
 *
 * 为什么要有：真库里的「纸盒/披萨盒」是咱们的事，拿它量出来的数不能证明通法。
 * 这盘用假人名、假事件、假物件，专测「换个叫法还找不找得到」。
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const home = mkdtempSync(join(tmpdir(), 'synthsea-'))
process.env.USERPROFILE = home
process.env.HOME = home
process.env.C2_NO_REFUSAL_LOG = '1'
mkdirSync(join(home, '.dsh'), { recursive: true })

const S = await import('file:///' + join(ROOT, 'lib', 'store.js').replace(/\\/g, '/'))
const T = await import('file:///' + join(ROOT, 'lib', 'tools.js').replace(/\\/g, '/'))
const sea = 'synth'
S.ensureSea(sea)
const mk = (i, title, text) => ({ id: 's' + i, title, text, alias: '', kind: 'fact', born: Date.now() - i * 1000, seen: 0 })
S.writeSea(sea, {
  version: 3,
  edges: [],
  points: [
    mk(1, '周五晚上的披萨盒', '那天她带回来的披萨盒，扣在键盘上当了帽子。'),
    mk(2, '图书馆的三号座位', '三号座位靠窗，下午四点有太阳。'),
    mk(3, '老周的蓝色保温杯', '老周那个蓝色保温杯，盖子上有裂纹。'),
    mk(4, '阿岚的猫叫豆沙', '阿岚的猫叫豆沙，橘色，怕生。'),
    mk(5, '地铁四号线的早高峰', '四号线早高峰，八点二十最挤。'),
    mk(6, '小满的旧自行车', '小满那辆旧自行车，刹车有点响。'),
    mk(7, '楼下的豆浆摊', '楼下豆浆摊，两块钱一碗，加糖不要钱。'),
    mk(8, '那盒颜料少了赭石', '颜料盒里少了赭石，画不出那种土红。'),
    mk(9, '海边的塑料桶', '海边捡的塑料桶，装了半桶贝壳。'),
    mk(10, '二手市场的那张椅子', '椅子是榆木的，扶手磨得发亮。'),
    mk(11, '程野修过的收音机', '程野把收音机修好了，能收到短波。'),
    mk(12, '窗台的多肉', '窗台那盆多肉，两个星期没浇水还活着。'),
  ],
})

// must=该出现的关键词；want=期望的形态：hit=直接给条目；confirm=问一句是不是这条
const cases = [
  ['披萨盒', '纸盒扣在键盘上当帽子', '上位词', 'hit'],
  ['豆沙', '阿岚养的橘猫叫什么', '换说法', 'hit'],
  ['蓝色保温杯', '老周那个杯子啥颜色', '属性换问法', 'hit'],
  ['豆浆摊', '楼下早点摊豆浆多少钱', '上位词', 'confirm'],
  ['椅子', '二手市场那张木头椅子', '材质换叫法', 'confirm'],
  ['收音机', '程野修好了啥电器', '泛指', 'hit'],
]
let hit = 0, conf = 0, miss = 0
for (const [must, q, kind, want] of cases) {
  const out = await T.searchTool.execute({ sea, query: q, limit: 5 }, {})
  const t = String((out && out.log) || '')
  const hasMust = t.includes(must)
  const isConfirm = /是不是《/.test(t)
  if (hasMust) hit++
  else if (isConfirm) conf++
  else miss++
  console.log('  ' + (hasMust ? '中 ' : isConfirm ? '问 ' : '没 ') + '[' + kind + '] ' + q + ' → ' + t.replace(/\s+/g, ' ').slice(0, 66))
}
console.log('\n  合成库：直接命中 ' + hit + ' · 追问确认 ' + conf + ' · 没着落 ' + miss + '（共 ' + cases.length + '）')
console.log('  记法：追问算「找对人、等一句认领」，不算瞎答。')