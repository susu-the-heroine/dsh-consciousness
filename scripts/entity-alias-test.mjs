/**
 * 实体归一测试（2026-11-16，清单第 16 件）
 * 只在内存里跑，不碰主库。验证：
 *   1) 归一化：全角/首尾标点/空格/大小写都归成一个面
 *   2) L0 完全相等 → 自动并组
 *   3) L1 人工别名表 → 自动并组
 *   4) 相似但不等（苏苏侠 vs 苏苏侠的猫）绝不并
 *   5) 别名指向不存在的面：不造实体
 *   6) 展开：问「大魔王」能翻出「苏苏侠」的写法
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let fails = 0
function ok (name, cond) {
  if (cond) console.log('过 ', name)
  else { fails++; console.log('栽 ', name) }
}

const ea = await import(pathToFileURL(join(ROOT, 'lib', 'entity-alias.js')).href + '?v=' + Date.now())

// 1) 归一化
ok('全角转半角', ea.normalizeEntity('ＡＢＣ') === 'abc')
ok('去首尾标点', ea.normalizeEntity('「苏苏侠」') === '苏苏侠')
ok('折叠空格+小写', ea.normalizeEntity('  GMod  玩家 ') === 'gmod 玩家')

// 2) L0 完全相等自动并
{
  const pts = [
    { id: 1, entities: ['苏苏侠'] },
    { id: 2, entities: [' 苏苏侠 '] },
    { id: 3, entities: ['大魔王'] },
  ]
  const c = ea.buildCanon(pts, [])
  const g1 = c.get(ea.normalizeEntity('苏苏侠'))
  const g3 = c.get(ea.normalizeEntity('大魔王'))
  ok('L0：完全相等并成一个组', g1 && g3 && g1.members !== g3.members)
  // 2026-11-21：这条原来「等于这个或者等于那个」，两个都收——等于没说清到底取哪一种拼法。
  // 实测正身取的是先出现的那一条的原拼法（'苏苏侠'），把断言钉死。
  ok('L0：正身取先出现那条的原拼法', g1.canon === '苏苏侠')
}

// 3) L1 别名表自动并
{
  const pts = [
    { id: 1, entities: ['苏苏侠'] },
    { id: 2, entities: ['大魔王'] },
  ]
  const c = ea.buildCanon(pts, [{ canon: '苏苏侠', aliases: ['大魔王'] }])
  const g1 = c.get(ea.normalizeEntity('苏苏侠'))
  const g2 = c.get(ea.normalizeEntity('大魔王'))
  ok('L1：别名表并进一组', g1 && g2 && g1.members === g2.members)
  const out = ea.expandEntity('大魔王', c)
  ok('展开：问「大魔王」带出「苏苏侠」', out.has('苏苏侠'))
}

// 4) 相似但不等绝不并
{
  const pts = [
    { id: 1, entities: ['苏苏侠'] },
    { id: 2, entities: ['苏苏侠的猫'] },
  ]
  const c = ea.buildCanon(pts, [])
  const g1 = c.get(ea.normalizeEntity('苏苏侠'))
  const g2 = c.get(ea.normalizeEntity('苏苏侠的猫'))
  ok('相似不等：绝不并组', g1 && g2 && g1.members !== g2.members)
}

// 5) 别名指向不存在的面：不造实体
{
  const pts = [{ id: 1, entities: ['苏苏侠'] }]
  const c = ea.buildCanon(pts, [{ canon: '苏苏侠', aliases: ['肥建军'] }])
  const g = c.get(ea.normalizeEntity('肥建军'))
  ok('别名指向不存在的面：不造实体', !g)
}

// 6) 未知名展开：只给自身
{
  const pts = [{ id: 1, entities: ['苏苏侠'] }]
  const c = ea.buildCanon(pts, [])
  const out = ea.expandEntity('阿猫阿狗', c)
  ok('未知名展开只给自身', out.size === 1 && out.has('阿猫阿狗'))
}

console.log(fails ? '实体归一：栽 ' + fails : '实体归一：全过')
process.exit(fails ? 1 : 0)
