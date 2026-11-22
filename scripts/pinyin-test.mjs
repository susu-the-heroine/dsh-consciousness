/**
 * 拼音双通道测试（2026-11-16，清单第 17 件）
 * 只在沙箱跑，不碰主库。验证：
 *   1) 汉字->全拼/首字母/bigram 三条道都对
 *   2) 错别字（酥酥侠）能捞回「苏苏侠」
 *   3) 纯首字母（ssx）能捞回
 *   4) 倒装 bigram 也能撞上
 *   5) 完全不搭的给 0
 */
// 2026-11-21：这份只算内存里的字符串，不写任何文件——原来引入的临时目录、写文件、
// 系统临时目录这三样一次都没用过；路径还从同一个包引了两回。一起清掉。
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let fails = 0
function ok (name, cond) {
  if (cond) console.log('过 ', name)
  else { fails++; console.log('栽 ', name) }
}

const py = await import(pathToFileURL(join(ROOT, 'lib', 'pinyin.js')).href + '?v=' + Date.now())

// 1) 三条道
ok('全拼：苏苏侠 -> susuxia', py.pyFull('苏苏侠') === 'susuxia')
ok('首字母：苏苏侠 -> ssx', py.pyInitials('苏苏侠') === 'ssx')
ok('多音字取第一音：行 -> xing', py.pyFull('行') === 'xing')
ok('非汉字保留：GMod', py.pyFull('GMod') === 'gmod')

// 2) 错别字：酥酥侠（su su xia）应撞上正文写「苏苏侠」的条目
{
  const point = { title: '苏苏侠是谁', text: '他本名苏苏侠。' }
  const q = py.pinyinQuery('酥酥侠')
  const r = py.pinyinRel(q, point)
  ok('错别字同音能捞回（>=0.7）', r >= 0.7)
}

// 3) 纯首字母 ssx
{
  const point = { title: '苏苏侠是谁', text: '' }
  const q = py.pinyinQuery('ssx')
  const r = py.pinyinRel(q, point)
  ok('纯首字母 ssx 能捞回（>=0.7）', r >= 0.7)
}

// 4) 倒装：问「侠苏苏」bigram 无序也能撞
{
  const point = { title: '苏苏侠的底子', text: '' }
  const q = py.pinyinQuery('侠苏苏')
  const r = py.pinyinRel(q, point)
  ok('倒装 bigram 能撞上（>0）', r > 0)
}

// 5) 不搭的给 0
{
  const point = { title: '披萨盒的无奈', text: 'GMod 里没有大米饭。' }
  const q = py.pinyinQuery('经十路')
  const r = py.pinyinRel(q, point)
  ok('完全不搭给 0', r === 0)
}

// 6) 查询侧缓存挂在点上，第二次不再重算（行为正确即可，不测耗时）
{
  const point = { title: '缓存验证', text: '这条的拼音只算一次' }
  const q = py.pinyinQuery('huan cun yan zheng')
  const r1 = py.pinyinRel(q, point)
  const r2 = py.pinyinRel(q, point)
  ok('同一查询两次结果一致', Math.abs(r1 - r2) < 1e-9)
// 2026-11-20：缓存从条目上挪进内存 WeakMap 了——条目上不该长东西，否则会被整块写回 data.json。
ok('条目上不留拼音缓存', !('_py' in point), JSON.stringify(Object.keys(point)).slice(0, 40))
}

console.log(fails ? '拼音测试：栽 ' + fails : '拼音测试：全过')
process.exit(fails ? 1 : 0)
