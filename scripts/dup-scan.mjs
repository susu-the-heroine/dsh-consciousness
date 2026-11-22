/**
 * 查重扫描：库里有没有"同一件事记了两遍"
 * ======================================
 *
 * 只读，不改。字面 bigram 的 Jaccard，够简单、够快，也不需要向量。
 * 用法：
 *   node scripts/dup-scan.mjs            # 默认 main，阈值 0.40
 *   node scripts/dup-scan.mjs sandbox 0.5
 *
 * 为什么不用向量：这条只想知道"字面就几乎一样"的那批；
 * 语义相近但说法不同的，属于另一件事（合并要人判）。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sea = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'main'
const th = Number(process.argv[3]) || 0.4

const p = join(homedir(), '.dsh', 'consciousness-seas', sea, 'data.json')
const data = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const all = data.points || []
const deadN = all.filter((x) => x.dead).length
const archN = all.filter((x) => x.archived).length
// 2026-11-21：原来只剔死的、没剔归档，可下面却把这一堆叫「活」——实测报「活 226」，
// 其实其中五条是归档的。归档已经不在场上，拿它们互相查重只是噪音。剔掉，标签才对得上。
const pts = all.filter((x) => !x.dead && !x.archived)

const grams = (s) => {
  const t = String(s || '').replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}

const docs = pts.map((x) => ({
  id: Number(x.id),
  title: String(x.title || '').slice(0, 26),
  g: grams(String(x.title || '') + ' ' + String(x.alias || '') + ' ' + String(x.text || '')),
}))

const pairs = []
for (let i = 0; i < docs.length; i++) {
  for (let j = i + 1; j < docs.length; j++) {
    const a = docs[i].g, b = docs[j].g
    if (!a.size || !b.size) continue
    let inter = 0
    for (const g of a) if (b.has(g)) inter++
    const jac = inter / (a.size + b.size - inter)
    if (jac >= th) pairs.push({ jac, a: docs[i], b: docs[j] })
  }
}
pairs.sort((x, y) => y.jac - x.jac)

console.log(`海 ${sea} · 总 ${all.length}（活 ${pts.length} / 死 ${deadN} / 归档 ${archN}） · 阈值 ${th} · 疑似重复 ${pairs.length} 对`)
for (const x of pairs.slice(0, 20)) {
  console.log(`  ${x.jac.toFixed(2)}  #${x.a.id} ${x.a.title}  ||  #${x.b.id} ${x.b.title}`)
}
if (!pairs.length) console.log('  没有。这个库目前干净——别凭印象说"记重了"，跑这个数。')
