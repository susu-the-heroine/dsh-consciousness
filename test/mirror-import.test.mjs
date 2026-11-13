/**
 * 导入功能的测试：解析那一半
 * ==========================
 *
 * `memory_import` 是把导出的 Markdown 读回来。整条链路要动盘，测试里不碰真库；
 * 但最容易出错的是解析——front-matter 的引号、别名提示行、正文里的换行。
 * 这几样坏一次，导进去的就是残的，而且不报错。
 *
 * 跑法：node test/mirror-import.test.mjs
 */
import { parseMirrorFile } from '../lib/mirror-import.js'

let pass = 0
let fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}

// 一份标准导出：字段齐、带别名提示行
const full = `---
id: 7
title: "本名的重量"
alias: "我叫你这名字是怎么回事"
kind: fact
imp: 0.8
arousal: 10
polarity: 1
born: 1793603985388
strength: 3650
layer: core
era: ds
category: "事实、关系"
entities: "大魔王、大肥鱼"
text_hash: bacd69025a7fefed
open: true
rule: false
---

> 别人可能这样问：我叫你这名字是怎么回事

第一段。
第二段，带一个"引号"和《书名号》。
`

const p = parseMirrorFile(full)
ok(p !== null, '能解析出来')
ok(p && p.title === '本名的重量', '标题里的引号被剥掉', p && p.title)
ok(p && p.alias === '我叫你这名字是怎么回事', '别名读对')
ok(p && p.born === 1793603985388, '出生时间不是重新生成的', p && String(p.born))
ok(p && p.imp === 0.8, '置信度是数字', p && String(p.imp))
ok(p && p.open === true && p.rule === false, '布尔字段没被读成字符串', p && p.open + '/' + p.rule)
ok(p && Array.isArray(p.category) && p.category.length === 2, '分类拆成数组', p && JSON.stringify(p.category))
ok(p && !p.text.includes('别人可能这样问'), '别名提示行不进正文')
ok(p && p.text.includes('第二段'), '正文两段都在')
ok(p && p.text.includes('"引号"'), '正文里的引号原样保留')

// 没有 front-matter 的：要返回 null，不许瞎编
ok(parseMirrorFile('# 一个普通文档\n\n没有字段。') === null, '没有 front-matter 返回 null')

// 没有标题的：也不收
ok(parseMirrorFile('---\nid: 1\n---\n\n正文') === null, '没有标题返回 null')

// 空正文：收，但正文是空字符串（不编内容）
const empty = parseMirrorFile('---\nid: 2\ntitle: "空的"\n---\n')
ok(empty && empty.text === '', '空正文就是空字符串，不编内容', empty && JSON.stringify(empty.text))

console.log('通过 ' + pass + ' · 失败 ' + fail)
process.exit(fail ? 1 : 0)
