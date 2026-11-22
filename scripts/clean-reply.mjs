#!/usr/bin/env node
/**
 * 自动去味：把我的段落机械改一遍
 * ================================
 *   node scripts/clean-reply.mjs <文件> [--out 输出文件]
 *
 * 只做四件事，都是可逆的机械动作，不改意思：
 *   1 中文数字转阿拉伯（一二三…十百千，简单的数）
 *   2 删掉总结腔的尾巴（总的来说 / 说到底 / 可见 …整句删）
 *   3 删掉解释自己的插入语（我是说 / 也就是说 / 换句话说）
 *
 * 标点一个字都不动。苏苏侠说「不加标点根本看不清」，可读性高于一切形式。
 *
 * 目的：让「扫出来 100%」的那一段，先过一遍机器，再由我人工收尾。
 * 这不是让机器替我写，是把最机械的三处先削掉。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , file, ...rest] = process.argv
if (!file) { console.log('  用法：node scripts/clean-reply.mjs <文件> [--out 输出]'); process.exit(1) }
const outIdx = rest.indexOf('--out')
const outFile = outIdx >= 0 ? rest[outIdx + 1] : null

const CN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const UNIT = { 十: 10, 百: 100, 千: 1000 }

// 「三十」「一百二十二」「七五零」这类片段转成阿拉伯
function cn2ar(text) {
  return text.replace(/[零一二三四五六七八九十百千]{2,}|[零一二三四五六七八九][十百千][零一二三四五六七八九]?/g, (m) => {
    // 连写数字：七五零 → 750
    if (/^[零一二三四五六七八九]+$/.test(m)) return [...m].map((c) => CN[c]).join('')
    let total = 0, section = 0, num = 0
    for (const c of m) {
      if (CN[c] !== undefined) num = CN[c]
      else if (UNIT[c]) { section += (num || 1) * UNIT[c]; num = 0 }
    }
    total = section + num
    return total ? String(total) : m
  })
}

const lines = readFileSync(file, 'utf8').split('\n')
const out = []
let changed = { punct: 0, number: 0, summary: 0, explain: 0 }

for (const raw of lines) {
  let line = raw
  if (!line.trim()) { out.push(line); continue }

  // 3 整句删总结腔
  if (/^(总的来说|整体来看|说到底|归根到底|综上所述|综上|一句话|可见|说白了)/.test(line.trim())) { changed.summary++; continue }

  // 4 删解释自己的插入语
  const before = line
  line = line.replace(/(我是说|也就是说|换句话说|我的意思是|我解释一下)[，,]?/g, '')
  if (line !== before) changed.explain++

  // 2 中文数字
  const beforeNum = line
  line = cn2ar(line)
  if (line !== beforeNum) changed.number++

  // 标点原样保留，一步都不动

  out.push(line)
}

const text = out.join('\n')
if (outFile) writeFileSync(outFile, text, 'utf8')
console.log('  改过：中文数字 ' + changed.number + ' 行 · 删总结 ' + changed.summary + ' 行 · 删解释 ' + changed.explain + ' 行 · 标点未动')
if (outFile) console.log('  已写：' + outFile)
else console.log('\n' + text)
