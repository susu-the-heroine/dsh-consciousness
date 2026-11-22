#!/usr/bin/env node
/**
 * 阈值校准：三类本地语料各跑一遍，看「有腔率」
 * ==========================================
 *   node scripts/calib.mjs
 *
 * ①真人：他本人的长消息（docs/真人长消息-500.md 取前 200 条）——误报要 ≤2%
 * ②机器：我自己按规矩写的三批答（第六/七/八批）——允许高，只报数
 * ③半机器：项目说明里成段的文字（文档腔，不是聊天）——允许高，只报数
 *
 * 只用本地文件，不联网。
 */
import { readFileSync, existsSync } from 'node:fs'
import { aiflavor } from '../lib/aiflavor.js'

const BAD = 0.35
const HERE = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function loadLines(files, cap) {
  const out = []
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const t = raw.replace(/^\d+[.、]\s*/, '').trim()
      if ([...t].length < 10) continue
      out.push(t)
      if (out.length >= cap) return out
    }
  }
  return out
}

function paragraphs(file, cap) {
  if (!existsSync(file)) return []
  const blocks = readFileSync(file, 'utf8').split(/\n\s*\n/)
  const out = []
  for (const b of blocks) {
    const t = b.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()
    if ([...t].length < 30) continue
    out.push(t)
    if (out.length >= cap) return out
  }
  return out
}

function rate(name, arr, gate) {
  if (!arr.length) { console.log('  ' + name + '：没有样本'); return null }
  let bad = 0
  const kinds = {}
  for (const t of arr) {
    const r = aiflavor(t)
    if (r.score >= BAD) bad++
    for (const k of r.kinds) kinds[k] = (kinds[k] || 0) + 1
  }
  const p = bad / arr.length * 100
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + '×' + v).join(' · ') || '干净'
  const mark = gate == null ? '' : (p <= gate ? '（达标 ≤' + gate + '%）' : '（超线，要调）')
  console.log('  ' + name + '：' + arr.length + ' 条 · 有腔 ' + bad + '（' + p.toFixed(1) + '%）' + mark)
  console.log('    主要类型：' + top)
  return p
}

console.log('  口径：aiflavor 分数 ≥' + BAD + ' 判有腔')
rate('①真人（他的长消息）', loadLines([HERE + 'docs/真人长消息-500.md'], 200).slice(0, 200), 2)
rate('②机器（我写的回复，含旧批与盲写）', loadLines([
  HERE + 'docs/人格一致率-第六批.md',
  HERE + 'docs/人格一致率-第七批.md',
  HERE + 'docs/人格一致率-第八批.md',
  HERE + 'docs/真人对照-我的20条.md',
  HERE + 'docs/盲写-20条-默认我.md',
  HERE + 'docs/人格一致率-第五批.md',
], 200), null)
// ③ 半机器：多份文档一起凑，项目说明不够就换别的，别拿 49 段当结论
const docFiles = [
  HERE + 'docs/项目说明.md',
  HERE + 'docs/接手说明.md',
  HERE + 'README.md',
  HERE + 'CHANGELOG.md',
  HERE + 'docs/像人手册-v1.md',
]
let semi = []
for (const f of docFiles) {
  if (semi.length >= 200) break
  semi = semi.concat(paragraphs(f, 200 - semi.length))
}
rate('③半机器（多份文档成段）', semi, null)
