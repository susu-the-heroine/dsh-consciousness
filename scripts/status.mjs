/**
 * 一眼看全：库与向量覆盖
 * ======================
 *
 * 2026-11-21：头里原来写「库、日志、预算、配对」，可这份只打库和向量两段——
 * 日志和配对从来没在这儿打出来过，按头里去找会白翻一遍。照实改。
 * 只读，不改任何东西。
 *
 *   node scripts/status.mjs
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = join(homedir(), '.dsh')
const line = (s) => console.log(s)

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

// 库
const sea = 'main'
const d = readJson(join(HOME, 'consciousness-seas', sea, 'data.json'))
if (d) {
  const all = d.points || []
  const dead = all.filter((x) => x.dead).length
  const arch = all.filter((x) => x.archived).length
  const alive = all.filter((x) => !x.dead && !x.archived)
  const notDead = all.filter((x) => !x.dead).length
  line(`库 ${sea}：总 ${all.length} · 进检索 ${alive.length} · 非死 ${notDead} · 死 ${dead} · 归档 ${arch} · 边 ${(d.edges || []).length}`)
  // 两个口径都打出来：dup-scan 用的是"非死"，检索用的是"非死且未归档"。以前混着说，报过两个数。
  const noAlias = alive.filter((x) => !String(x.alias || '').trim()).length
  const noTime = alive.filter((x) => !Number(x.born)).length
  line(`  没别名 ${noAlias} 条 · 没时间 ${noTime} 条`)
}

// 向量覆盖：没有向量的记忆只能被字面找到，按意思永远找不到——不报错，只会悄悄变窄。
{
  const vd = readJson(join(HOME, 'consciousness-seas', sea, 'vectors.json'))
  const dd = readJson(join(HOME, 'consciousness-seas', sea, 'data.json'))
  if (vd && dd) {
    const alive2 = (dd.points || []).filter((x) => !x.dead && !x.archived && !x.validUntil)
    const have = new Set(Object.keys(vd).map(Number))
    const miss = alive2.filter((x) => !have.has(Number(x.id))).length
    line(`向量：活 ${alive2.length} · 有 ${have.size} · 缺 ${miss}` + (miss ? '（补：node scripts/embed-backfill.mjs main）' : ''))
  }
}
